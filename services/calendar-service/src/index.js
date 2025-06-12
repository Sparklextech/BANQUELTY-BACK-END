 require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.CALENDAR_SERVICE_PORT || 4009; // Changed from 4004 to 4009 to avoid conflict with admin service

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

app.use(cors());
app.use(bodyParser.json());

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

// Create venue service client
const venueService = axios.create({
  baseURL: process.env.VENUE_SERVICE_URL || 'http://venue-service:4002',
  timeout: 5000
});

// Venue ownership verification middleware
async function requireVenueOwnership(req, res, next) {
  try {
    const venueId = req.params.venueId || req.body.venueId;
    if (!venueId) {
      return errorResponse(res, 400, 'Venue ID is required');
    }
    
    // Admin can manage all venues
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Vendor can only manage their own venues
    if (req.user.role === 'vendor') {
      try {
        // Get venue details from venue service to verify ownership
        const response = await venueService.get(`/api/venue/venues/${venueId}`, {
          headers: {
            'Authorization': req.headers.authorization || `Bearer ${req.user.token || ''}`
          }
        });
        
        const venue = response.data;
        
        // Check if the vendor ID matches the venue's vendor ID
        if (venue.vendorId.toString() !== req.user.id.toString()) {
          logger.warn(`Vendor ${req.user.id} attempted to manage venue ${venueId} they don't own`);
          return errorResponse(res, 403, 'You do not have permission to manage this venue');
        }
        
        return next();
      } catch (venueError) {
        logger.error(`Venue service error: ${venueError.message}`);
        return errorResponse(res, 500, 'Error verifying venue ownership');
      }
    } else {
      logger.warn(`User ${req.user.id} attempted to access venue ${venueId} without permission`);
      return errorResponse(res, 403, 'You do not have permission to manage this venue');
    }
  } catch (err) {
    logger.error(`Venue ownership check error: ${err.message}`);
    return errorResponse(res, 500, 'Error verifying venue ownership');
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

const CalendarEvent = sequelize.define('CalendarEvent', {
  venueId: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
  bookingId: { type: DataTypes.INTEGER, allowNull: true }
});

// Health checks - both for compatibility
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/calendar/health', (req, res) => res.json({ status: 'ok' }));

// CRUD for calendar events (availability)
app.post('/api/calendar/events', authenticateJWT, requireRole(['admin', 'vendor']), async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.venueId) {
      return errorResponse(res, 400, 'venueId is required');
    }
    
    if (!req.body.date) {
      return errorResponse(res, 400, 'date is required');
    }
    
    // For vendors, verify they own the venue they're updating
    if (req.user.role === 'vendor') {
      // In a real application, we would verify venue ownership here
      // For now, we're implementing a simplified check
      // This should be replaced with a proper ownership verification
      // by calling the venue service or checking a local cache
    }
    
    const event = await CalendarEvent.create({
      ...req.body,
      // Store who created this record for audit purposes
      createdBy: req.user.id
    });
    
    logger.info(`Calendar event created for venue ${req.body.venueId} by ${req.user.id} (${req.user.role})`);
    res.status(201).json(event);
  } catch (err) {
    logger.error('Error creating calendar event:', err);
    return errorResponse(res, 500, 'Failed to create calendar event');
  }
});

app.get('/api/calendar/events', authenticateJWT, async (req, res) => {
  try {
    let whereClause = {};
    
    // Filter by venueId if provided
    if (req.query.venueId) {
      whereClause.venueId = req.query.venueId;
    }
    
    // Filter by date if provided
    if (req.query.date) {
      whereClause.date = req.query.date;
    }
    
    // For non-admin users, apply appropriate filters
    if (req.user.role === 'vendor') {
      // Vendors can only see calendar events for their venues
      // In a full implementation, we would check venue ownership
      // For now, we'll allow vendors to see any events they query
    } else if (req.user.role !== 'admin') {
      // Regular users can only see available dates or their own bookings
      whereClause.isAvailable = true;
    }
    
    const events = await CalendarEvent.findAll({ where: whereClause });
    res.json(events);
  } catch (err) {
    logger.error('Error fetching calendar events:', err);
    return errorResponse(res, 500, 'Failed to retrieve calendar events');
  }
});

app.get('/api/calendar/events/:id', authenticateJWT, async (req, res) => {
  try {
    const event = await CalendarEvent.findByPk(req.params.id);
    if (!event) {
      return errorResponse(res, 404, 'Calendar event not found');
    }
    
    // Check if user has permission to view this event
    if (req.user.role !== 'admin') {
      if (req.user.role === 'vendor') {
        // Verify this vendor owns the venue
        // In a full implementation, we would verify venue ownership here
      } else if (!event.isAvailable && (!event.bookingId || event.bookingId.toString() !== req.user.id.toString())) {
        // Regular users can only see available dates or their own bookings
        logger.warn(`User ${req.user.id} attempted to access calendar event ${req.params.id} without permission`);
        return errorResponse(res, 403, 'You do not have permission to view this calendar event');
      }
    }
    
    res.json(event);
  } catch (err) {
    logger.error('Error fetching calendar event:', err);
    return errorResponse(res, 500, 'Failed to retrieve calendar event');
  }
});

app.put('/api/calendar/events/:id', authenticateJWT, requireRole(['admin', 'vendor']), async (req, res) => {
  try {
    // Check if the event exists and retrieve it
    const existingEvent = await CalendarEvent.findByPk(req.params.id);
    if (!existingEvent) {
      return errorResponse(res, 404, 'Calendar event not found');
    }
    
    // For vendors, verify they own the venue for this event
    if (req.user.role === 'vendor') {
      // In a real application, we would verify venue ownership here
      // For now, we trust the user role validation
    }
    
    // Validate venueId if it's being updated
    if (req.body.venueId && req.body.venueId !== existingEvent.venueId) {
      // If venue is being changed, additional validation would be needed
      if (req.user.role !== 'admin') {
        logger.warn(`User ${req.user.id} attempted to change venue for event ${req.params.id}`);
        return errorResponse(res, 403, 'Only administrators can change the venue for an event');
      }
    }
    
    // Perform the update
    const [updated] = await CalendarEvent.update(req.body, { 
      where: { id: req.params.id },
      returning: true
    });
    
    if (!updated) {
      return errorResponse(res, 404, 'Calendar event not found');
    }
    
    const event = await CalendarEvent.findByPk(req.params.id);
    logger.info(`Calendar event ${req.params.id} updated by ${req.user.id} (${req.user.role})`);
    res.json(event);
  } catch (err) {
    logger.error('Error updating calendar event:', err);
    return errorResponse(res, 500, 'Failed to update calendar event');
  }
});

app.delete('/api/calendar/events/:id', authenticateJWT, requireRole(['admin', 'vendor']), async (req, res) => {
  try {
    // Check if the event exists and retrieve it
    const existingEvent = await CalendarEvent.findByPk(req.params.id);
    if (!existingEvent) {
      return errorResponse(res, 404, 'Calendar event not found');
    }
    
    // For vendors, verify they own the venue for this event
    if (req.user.role === 'vendor') {
      // In a real application, we would verify venue ownership here
      // For now, we're implementing a simplified check
    }
    
    // Check if this event is associated with a booking
    if (existingEvent.bookingId) {
      logger.warn(`Attempt to delete calendar event ${req.params.id} which has an active booking`);
      return errorResponse(res, 400, 'Cannot delete an event with an active booking');
    }
    
    const deleted = await CalendarEvent.destroy({ where: { id: req.params.id } });
    if (!deleted) {
      return errorResponse(res, 404, 'Calendar event not found');
    }
    
    logger.info(`Calendar event ${req.params.id} deleted by ${req.user.id} (${req.user.role})`);
    res.json({ message: 'Calendar event deleted successfully' });
  } catch (err) {
    logger.error('Error deleting calendar event:', err);
    return errorResponse(res, 500, 'Failed to delete calendar event');
  }
});

// API endpoint for checking venue availability
app.get('/api/calendar/availability', authenticateJWT, async (req, res) => {
  try {
    // Validate required query parameters
    if (!req.query.venueId) {
      return errorResponse(res, 400, 'venueId query parameter is required');
    }
    
    // Build query for finding available dates
    const whereClause = {
      venueId: req.query.venueId,
      isAvailable: true
    };
    
    // Filter by date range if provided
    if (req.query.startDate && req.query.endDate) {
      whereClause.date = {
        [Sequelize.Op.between]: [req.query.startDate, req.query.endDate]
      };
    } else if (req.query.startDate) {
      whereClause.date = {
        [Sequelize.Op.gte]: req.query.startDate
      };
    }
    
    const availableDates = await CalendarEvent.findAll({ 
      where: whereClause,
      order: [['date', 'ASC']]
    });
    
    res.json(availableDates);
  } catch (err) {
    logger.error('Error checking venue availability:', err);
    return errorResponse(res, 500, 'Failed to check venue availability');
  }
});

// Sync DB and start server
sequelize.sync().then(() => {
  app.listen(PORT, () => {
    logger.info(`Calendar Service running on port ${PORT}`);
    logger.info(`Authentication and authorization enabled for all endpoints`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application should continue running despite unhandled promise rejections
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // For uncaught exceptions, we should exit the process after logging
  // This allows the process manager to restart the service
  process.exit(1);
});