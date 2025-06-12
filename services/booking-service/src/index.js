require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const PORT = process.env.BOOKING_SERVICE_PORT || 4005;

// Ensure JWT_SECRET is properly set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required but not set');
  process.exit(1);
}

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

app.use(bodyParser.json());

// Service API clients
const venueService = axios.create({
  baseURL: process.env.VENUE_SERVICE_URL || 'http://venue-service:4002',
  timeout: 5000
});

// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// JWT authentication middleware
function authenticateJWT(req, res, next) {
  try {
    // Primary path: Trust Gateway header
    if (req.headers['x-user-id'] && req.headers['x-user-role']) {
      req.user = {
        id: req.headers['x-user-id'],
        role: req.headers['x-user-role']
      };
      return next();
    }
    
    // Fallback for direct access: Validate JWT
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return errorResponse(res, 401, 'Authentication required');
    }
    
    // Validate token format explicitly
    if (!authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 401, 'Invalid authorization format. Format is: Bearer [token]');
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      return errorResponse(res, 401, 'Empty token provided');
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    logger.info(`Authenticated user ${decoded.id} (${decoded.role})`);
    next();
  } catch (err) {
    logger.error('JWT validation error:', err.message);
    return errorResponse(res, 401, 'Invalid token');
  }
}

// Role-based authorization middleware
function requireRole(roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 401, 'Authentication required');
    }
    
    if (!roles.includes(req.user.role)) {
      logger.warn(`Access denied for user ${req.user.id} (${req.user.role}). Required roles: ${roles.join(', ')}`);
      return errorResponse(res, 403, 'Insufficient permissions');
    }
    
    next();
  };
}

// Booking ownership verification middleware
async function requireBookingOwnership(req, res, next) {
  try {
    const bookingId = req.params.id;
    if (!bookingId) {
      return errorResponse(res, 400, 'Booking ID is required');
    }
    
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      return errorResponse(res, 404, 'Booking not found');
    }
    
    // Allow if user is the booking owner, the venue's vendor, or an admin
    if (req.user.role === 'admin' ||
        (booking.userId && booking.userId.toString() === req.user.id.toString()) ||
        (req.user.role === 'vendor' && booking.vendorId && booking.vendorId.toString() === req.user.id.toString())) {
      req.booking = booking; // Attach booking to request for convenience
      return next();
    }
    
    logger.warn(`User ${req.user.id} attempted to access booking ${bookingId} without permission`);
    return errorResponse(res, 403, 'You do not have permission to access this booking');
  } catch (err) {
    logger.error(`Booking ownership check error: ${err.message}`);
    return errorResponse(res, 500, 'Error verifying booking ownership');
  }
}

// Sequelize connection
const sequelize = new Sequelize(
  process.env.POSTGRES_DB || 'banquet_db',
  process.env.POSTGRES_USER || 'postgres',
  process.env.POSTGRES_PASSWORD || 'postgres',
  {
    host: process.env.POSTGRES_HOST || 'postgres',
    dialect: 'postgres',
    logging: false,
    port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT) : 5432,
  }
);

const Booking = sequelize.define('Booking', {
  userId: { type: DataTypes.INTEGER, allowNull: false },
  venueId: { type: DataTypes.INTEGER, allowNull: false },
  vendorId: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  guestCount: { type: DataTypes.INTEGER, allowNull: false },
  pricingType: { type: DataTypes.ENUM('flat', 'per_head'), allowNull: false },
  flatPrice: { type: DataTypes.FLOAT },
  perHeadPrice: { type: DataTypes.FLOAT },
  minGuests: { type: DataTypes.INTEGER },
  additionalServices: { type: DataTypes.JSONB },
  totalPrice: { type: DataTypes.FLOAT, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'confirmed', 'cancelled'), defaultValue: 'pending' }
});

// Health check
app.get('/api/booking/health', (req, res) => res.json({ status: 'ok' }));

// Create booking with price calculation - enhanced security and validation
app.post('/api/booking/bookings', authenticateJWT, async (req, res) => {
  try {
    // Use userId from authenticated user unless admin is creating for someone else
    let requestedUserId = req.body.userId;
    
    // Security check: Regular users can only book for themselves
    if (req.user.role !== 'admin') {
      // Force userId to be the authenticated user's ID
      requestedUserId = req.user.id;
      
      // Log attempt if user was trying to book for someone else
      if (req.body.userId && req.body.userId.toString() !== req.user.id.toString()) {
        logger.warn(`User ${req.user.id} attempted to create booking for another user: ${req.body.userId}. Overriding with authenticated user ID.`);
      }
    } else {
      // Admin case - validate that the target user exists
      if (!requestedUserId) {
        return errorResponse(res, 400, 'userId is required when admin creates booking for a user');
      }
      logger.info(`Admin ${req.user.id} creating booking for user ${requestedUserId}`);
    }
        // Extract and normalize data from request body
    let { 
      venueId,
      vendorId,
      date, 
      guestCount, 
      guests, // Alternative field name from test
      pricingType = 'flat',
      flatPrice,
      perHeadPrice, 
      minGuests, 
      additionalServices,
      status,
      notes
    } = req.body;
    
    // Use the authenticated user ID or admin-specified ID
    const userId = requestedUserId;
    
    // Validate required fields
    if (!userId) {
      return errorResponse(res, 400, 'userId is required');
    }
    
    // Validate venueId and vendorId are present
    if (!venueId) {
      return errorResponse(res, 400, 'venueId is required');
    }
    
    if (!vendorId) {
      return errorResponse(res, 400, 'vendorId is required');
    }
    
    // Verify that vendorId matches the venue's vendor
    try {
      const response = await venueService.get(`/api/venue/venues/${venueId}`, {
        headers: {
          'Authorization': req.headers.authorization
        }
      });
      
      const venue = response.data;
      if (venue.vendorId.toString() !== vendorId.toString()) {
        return errorResponse(res, 400, 'vendorId does not match the venue\'s vendor');
      }
    } catch (venueError) {
      logger.error(`Venue service error: ${venueError.message}`);
      return errorResponse(res, 500, 'Error verifying venue ownership');
    }

        // Map 'guests' to 'guestCount' if provided
    if (!guestCount && guests) {
      guestCount = guests;
    }
    
    // Validate guestCount
    if (!guestCount || isNaN(parseInt(guestCount)) || parseInt(guestCount) <= 0) {
      return errorResponse(res, 400, 'Valid guestCount is required');
    }
    
    guestCount = parseInt(guestCount);
    
    // Validate booking date
    if (!date) {
      return errorResponse(res, 400, 'Booking date is required');
    }
    
    const bookingDate = new Date(date);
    const currentDate = new Date();
    
    // Ensure booking date is in the future
    if (bookingDate < currentDate) {
      return errorResponse(res, 400, 'Booking date must be in the future');
    }

    // Validate pricing fields based on pricingType
    let totalPrice = 0;
    if (pricingType === 'flat') {
      if (!flatPrice || isNaN(parseFloat(flatPrice)) || parseFloat(flatPrice) <= 0) {
        return errorResponse(res, 400, 'flatPrice is required for flat pricing type');
      }
      flatPrice = parseFloat(flatPrice);
      totalPrice = flatPrice;
    } else if (pricingType === 'per_head') {
      if (!perHeadPrice || isNaN(parseFloat(perHeadPrice)) || parseFloat(perHeadPrice) <= 0) {
        return errorResponse(res, 400, 'perHeadPrice is required for per_head pricing type');
      }
      perHeadPrice = parseFloat(perHeadPrice);
      
      // Validate minGuests
      if (!minGuests) {
        minGuests = 1; // Default minimum guests if not provided
      } else {
        minGuests = parseInt(minGuests);
      }
      
      if (guestCount < minGuests) {
        return errorResponse(res, 400, `Guest count (${guestCount}) below minimum required (${minGuests})`);
      }
      
      totalPrice = guestCount * perHeadPrice;
    } else {
      return errorResponse(res, 400, 'Invalid pricingType. Must be "flat" or "per_head".');
    }
    
    if (Array.isArray(additionalServices)) {
      totalPrice += additionalServices.reduce((sum, s) => sum + (s.price || 0), 0);
    }
    
    // Create the booking with normalized data
    const booking = await Booking.create({ 
      userId, 
      venueId, 
      vendorId, 
      date, 
      guestCount, 
      pricingType, 
      flatPrice, 
      perHeadPrice, 
      minGuests, 
      additionalServices, 
      totalPrice,
      status: status || 'pending'
    });
    
    res.status(201).json(booking);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Get all bookings with pagination and filters
app.get('/api/booking/bookings', authenticateJWT, async (req, res) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    // Parse filter parameters
    const { status, fromDate, toDate } = req.query;
    const whereClause = {};
    
    // Status filter
    if (status && ['pending', 'confirmed', 'cancelled'].includes(status)) {
      whereClause.status = status;
    }
    
    // Date range filter
    if (fromDate && toDate) {
      whereClause.date = {
        [Sequelize.Op.between]: [fromDate, toDate]
      };
    } else if (fromDate) {
      whereClause.date = {
        [Sequelize.Op.gte]: fromDate
      };
    } else if (toDate) {
      whereClause.date = {
        [Sequelize.Op.lte]: toDate
      };
    }
    
    // Role-based access control
    if (req.user.role === 'admin') {
      // Admins can see all bookings
      // No changes to whereClause
      logger.info(`Admin ${req.user.id} accessing all bookings`);
    } else if (req.user.role === 'vendor') {
      // Vendors can see bookings for their venues
      whereClause.vendorId = req.user.id;
      logger.info(`Vendor ${req.user.id} accessing their bookings`);
    } else {
      // Regular users can only see their own bookings
      whereClause.userId = req.user.id;
      logger.info(`User ${req.user.id} accessing their bookings`);
    }
    
    // Fetch bookings with pagination
    const { count, rows: bookings } = await Booking.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
    
    // Return paginated response
    res.json({
      bookings,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    logger.error('Error fetching bookings:', err);
    return errorResponse(res, 500, 'Failed to retrieve bookings');
  }
});

// Get a single booking by ID - with proper authorization
app.get('/api/booking/bookings/:id', authenticateJWT, async (req, res) => {
  try {
    const bookingId = req.params.id;
    
    if (!bookingId) {
      return errorResponse(res, 400, 'Booking ID is required');
    }
    
    const booking = await Booking.findByPk(bookingId);
    
    if (!booking) {
      return errorResponse(res, 404, 'Booking not found');
    }
    
    // Enforce role-based access control
    const isAdmin = req.user.role === 'admin';
    const isVendor = req.user.role === 'vendor' && booking.vendorId.toString() === req.user.id.toString();
    const isOwner = booking.userId.toString() === req.user.id.toString();
    
    if (!isAdmin && !isVendor && !isOwner) {
      logger.warn(`User ${req.user.id} (${req.user.role}) attempted unauthorized access to booking ${bookingId}`);
      return errorResponse(res, 403, 'You do not have permission to access this booking');
    }
    
    logger.info(`User ${req.user.id} (${req.user.role}) accessed booking ${bookingId}`);
    res.json(booking);
  } catch (err) {
    logger.error(`Error fetching booking: ${err.message}`);
    return errorResponse(res, 500, 'Failed to retrieve booking');
  }
});

// Update booking status - with role-specific permissions
app.put('/api/booking/bookings/:id/status', authenticateJWT, requireBookingOwnership, async (req, res) => {
  try {
    // Validate status
    const allowedStatuses = ['pending', 'confirmed', 'cancelled'];
    if (!req.body.status || !allowedStatuses.includes(req.body.status)) {
      return errorResponse(res, 400, 'Invalid status value', 
        `Status must be one of: ${allowedStatuses.join(', ')}`);
    }
    
    // Role-specific permissions for status changes
    const newStatus = req.body.status;
    const currentStatus = req.booking.status;
    
    // If status is not changing, just return success
    if (currentStatus === newStatus) {
      return res.json(req.booking);
    }
    
    // Status change validation based on roles
    if (newStatus === 'confirmed') {
      // Only vendors who own the venue and admins can confirm bookings
      if (req.user.role !== 'admin' && (req.user.role !== 'vendor' || req.booking.vendorId.toString() !== req.user.id.toString())) {
        logger.warn(`User ${req.user.id} (${req.user.role}) attempted to confirm booking ${req.params.id} without permission`);
        return errorResponse(res, 403, 'Only the venue vendor or administrators can confirm bookings');
      }
    } else if (newStatus === 'cancelled') {
      // For cancellation, apply booking cancellation policy
      // Users can cancel their own bookings
      // Vendors can cancel bookings for their venues
      // Admins can cancel any booking
      
      // Check if booking is already confirmed and too close to the date
      if (currentStatus === 'confirmed') {
        const bookingDate = new Date(req.booking.date);
        const currentDate = new Date();
        const daysDifference = Math.ceil((bookingDate - currentDate) / (1000 * 60 * 60 * 24));
        
        // If booking date is less than 3 days away and user is trying to cancel, restrict it
        if (daysDifference < 3 && req.user.role === 'user') {
          logger.warn(`User ${req.user.id} attempted to cancel confirmed booking ${req.params.id} with less than 3 days' notice`);
          return errorResponse(res, 403, 'Cannot cancel confirmed booking with less than 3 days notice', 
            { daysDifference, minDaysRequired: 3 });
        }
      }
    }
    
    // At this point, all permission checks have passed
    await req.booking.update({ status: newStatus });
    
    // Enhanced logging for audit purposes
    logger.info({
      message: `Booking status updated`,
      bookingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
      oldStatus: currentStatus,
      newStatus: newStatus,
      timestamp: new Date().toISOString()
    });
    
    res.json(req.booking);
  } catch (err) {
    logger.error(`Error updating booking status: ${err.message}`);
    return errorResponse(res, 500, 'Failed to update booking status');
  }
});

// Delete booking - only admin or owner can delete
app.delete('/api/booking/bookings/:id', authenticateJWT, requireBookingOwnership, async (req, res) => {
  try {
    // Only allow admin or the actual owner (user who created the booking) to delete
    if (req.user.role !== 'admin' && req.booking.userId.toString() !== req.user.id.toString()) {
      logger.warn(`User ${req.user.id} (${req.user.role}) attempted to delete booking ${req.params.id} without permission`);
      return errorResponse(res, 403, 'Only administrators or the booking owner can delete bookings');
    }
    
    // For audit purposes, we'll soft delete by setting status to 'cancelled' and adding a flag
    await req.booking.update({ 
      status: 'cancelled',
      deletedBy: req.user.id,
      deletedAt: new Date(),
      deletionReason: req.body.reason || 'User requested deletion'
    });
    
    logger.info({
      message: 'Booking deleted/cancelled',
      bookingId: req.params.id,
      userId: req.user.id,
      userRole: req.user.role,
      reason: req.body.reason || 'User requested deletion'
    });
    
    res.json({ message: 'Booking successfully deleted', success: true });
  } catch (err) {
    logger.error(`Error deleting booking: ${err.message}`);
    return errorResponse(res, 500, 'Failed to delete booking');
  }
});

// Sync DB and start server
sequelize.sync().then(() => {
  app.listen(PORT, () => {
    logger.info(`Booking Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});
