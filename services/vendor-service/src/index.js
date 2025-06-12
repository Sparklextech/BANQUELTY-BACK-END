require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const winston = require('winston');

const app = express();
const PORT = process.env.VENDOR_SERVICE_PORT || 4003;
const jwt = require('jsonwebtoken');
const cors = require('cors');

// Ensure JWT_SECRET is properly set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required but not set');
  process.exit(1);
}

// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// --- Authentication Middleware ---
function authenticateJWT(req, res, next) {
  try {
    // Primary path: Trust Gateway header
    if (req.headers['x-user-id'] && req.headers['x-user-role']) {
      req.user = {
        id: req.headers['x-user-id'],
        role: req.headers['x-user-role'],
        // For KYC status checks
        kycStatus: req.headers['x-user-kyc-status'] || 'pending'
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

function requireVendorOrAdmin(req, res, next) {
  // Log only the path and action without sensitive user data
  logger.info(`[KYC Check] Validating vendor/admin access for path: ${req.path}`);
  
  if (req.user.role === 'admin') {
    logger.info(`[KYC Check] Admin access granted for path: ${req.path}`);
    return next();
  }
  
  if (req.user.role !== 'vendor') {
    // Log access denial without user ID
    logger.warn(`[KYC Check] Access denied - non-vendor role attempted to access: ${req.path}`);
    return errorResponse(res, 403, 'Forbidden: Only vendors can access this resource');
  }
  
  if (req.user.kycStatus !== 'approved') {
    // Log KYC check failure without user ID
    logger.warn(`[KYC Check] Access denied - KYC not approved for path: ${req.path}`);
    return errorResponse(res, 403, 'KYC verification not approved. Please complete the verification process.');
  }
  
  logger.info(`[KYC Check] Vendor access granted for path: ${req.path}`);
  next();
}

function requireOwnResourceOrAdmin(model, resourceIdField) {
  return async (req, res, next) => {
    try {
      // Admin override
      if (req.user.role === 'admin') return next();
      
      // Get the resource ID
      const id = req.params.id || req.body.id || req.body[resourceIdField];
      if (!id) {
        return errorResponse(res, 400, `${resourceIdField} is required`);
      }
      
      // Find the resource
      const resource = await model.findByPk(id);
      if (!resource) {
        return errorResponse(res, 404, `${resourceIdField} not found`);
      }
      
      // Ownership check
      if (resource.vendorId && resource.vendorId.toString() !== req.user.id.toString()) {
        logger.warn(`User ${req.user.id} attempted to access resource ${id} owned by vendor ${resource.vendorId}`);
        return errorResponse(res, 403, 'You do not have permission to access this resource');
      }
      
      // All checks passed
      next();
    } catch (err) {
      logger.error('Resource ownership check error:', err);
      return errorResponse(res, 500, 'Error verifying resource access');
    }
  };
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

// Vendor model
const Vendor = sequelize.define('Vendor', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  phone: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
});

// Venue model
const Venue = sequelize.define('Venue', {
  name: { type: DataTypes.STRING, allowNull: false },
  address: { type: DataTypes.STRING },
  capacity: { type: DataTypes.INTEGER },
  vendorId: { type: DataTypes.INTEGER, allowNull: false },
});

// Additional Service model
const AdditionalService = sequelize.define('AdditionalService', {
  name: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false },
  vendorId: { type: DataTypes.INTEGER, allowNull: false },
  venueId: { type: DataTypes.INTEGER, allowNull: false }, // Added to match venue-service schema
});

Vendor.hasMany(Venue, { foreignKey: 'vendorId' });
Venue.belongsTo(Vendor, { foreignKey: 'vendorId' });
Vendor.hasMany(AdditionalService, { foreignKey: 'vendorId' });
AdditionalService.belongsTo(Vendor, { foreignKey: 'vendorId' });

// Health check
app.get('/api/vendor/health', (req, res) => res.json({ status: 'ok' }));

// CRUD Vendor Profile
app.post('/api/vendor/vendors', authenticateJWT, requireVendorOrAdmin, async (req, res) => {
  try {
    // Only allow vendor to create their own profile
    const vendor = await Vendor.create({ ...req.body, id: req.user.id });
    res.status(201).json(vendor);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Get all vendors
app.get('/api/vendor/vendors', async (req, res) => {
  try {
    // Get all vendors without associations first to avoid schema errors
    const vendors = await Vendor.findAll();
    if (!vendors || vendors.length === 0) {
      return res.status(404).json({ error: 'No vendors found' });
    }
    
    // Handle response based on the role
    res.json(vendors);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get vendor by ID - with proper authentication and data privacy
app.get('/api/vendor/vendors/:id', authenticateJWT, async (req, res) => {
  try {
    const requestedVendorId = parseInt(req.params.id);
    
    // Find the vendor with associated data
    let vendor = await Vendor.findByPk(requestedVendorId, { 
      include: [{
        model: Venue,
        attributes: ['id', 'name', 'description', 'location', 'capacity', 'categoryId', 'amenities']
      }]
    });
    
    // If vendor profile doesn't exist but it's a valid user ID and the authenticated user is that vendor or an admin
    if (!vendor && (req.user.id === requestedVendorId || req.user.role === 'admin')) {
      try {
        logger.info(`User ${req.user.id} (${req.user.role}) creating default vendor profile for ID: ${requestedVendorId}`);
        
        // Attempt to create a basic vendor profile
        vendor = await Vendor.create({ 
          id: requestedVendorId,
          name: 'New Vendor', // Default name, can be updated later
          description: 'Vendor profile pending completion'
        });
        
        // Fetch again with associations to maintain consistent response format
        vendor = await Vendor.findByPk(requestedVendorId, { 
          include: [{
            model: Venue,
            attributes: ['id', 'name', 'description', 'location', 'capacity', 'categoryId', 'amenities']
          }]
        });
      } catch (createErr) {
        logger.error(`Failed to create default vendor profile: ${createErr.message}`);
        return errorResponse(res, 404, 'Vendor not found and could not be created automatically');
      }
    }
    
    if (!vendor) {
      return errorResponse(res, 404, 'Vendor not found');
    }
    
    // Apply different views of the data based on role
    const isOwner = req.user.id === requestedVendorId;
    const isAdmin = req.user.role === 'admin';
    
    // If not owner or admin, only return public information
    if (!isOwner && !isAdmin) {
      // Public view for regular users - omit sensitive information
      const publicVendor = {
        id: vendor.id,
        name: vendor.name,
        description: vendor.description,
        profileImage: vendor.profileImage,
        businessLocation: vendor.businessLocation,
        businessHours: vendor.businessHours,
        rating: vendor.rating,
        Venues: vendor.Venues // Already filtered sensitive fields in the query
      };
      
      return res.json(publicVendor);
    }
    
    // For owner or admin, return full details
    logger.info(`User ${req.user.id} (${req.user.role}) accessed vendor profile ${requestedVendorId}`);
    res.json(vendor);
  } catch (err) {
    logger.error(`Error fetching vendor: ${err.message}`);
    return errorResponse(res, 500, 'Failed to retrieve vendor information');
  }
});

app.put('/api/vendor/vendors/:id', authenticateJWT, requireVendorOrAdmin, requireOwnResourceOrAdmin(Vendor, 'id'), async (req, res) => {
  try {
    const [updated] = await Vendor.update(req.body, { where: { id: req.params.id } });
    if (!updated) return res.status(404).json({ error: 'Vendor not found' });
    const vendor = await Vendor.findByPk(req.params.id);
    res.json(vendor);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// CRUD Venues for Vendor
app.post('/api/vendor/vendors/:vendorId/venues', authenticateJWT, requireVendorOrAdmin, async (req, res) => {
  if (parseInt(req.params.vendorId) !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Not your vendor profile' });
  }
  try {
    const venue = await Venue.create({ ...req.body, vendorId: req.params.vendorId });
    res.status(201).json(venue);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Get venues for a specific vendor by ID
app.get('/api/vendor/vendors/:vendorId/venues', async (req, res) => {
  try {
    const venues = await Venue.findAll({ where: { vendorId: req.params.vendorId } });
    res.json(venues);
  } catch (err) {
    logger.error(`Error fetching venues for vendor ${req.params.vendorId}: ${err.message}`);
    return errorResponse(res, 500, 'Failed to fetch venues for vendor');
  }
});

// Get all venues for the currently authenticated vendor - needed by frontend
app.get('/api/vendor/venues', authenticateJWT, requireVendorOrAdmin, async (req, res) => {
  try {
    let whereClause = {};
    
    // If vendor, only show their venues
    if (req.user.role === 'vendor') {
      whereClause.vendorId = req.user.id;
    }
    
    const venues = await Venue.findAll({ 
      where: whereClause,
      include: [{ model: Category, attributes: ['id', 'name'] }]
    });
    
    logger.info(`User ${req.user.id} (${req.user.role}) fetched venues list`);
    res.json(venues);
  } catch (err) {
    logger.error(`Error fetching venues: ${err.message}`);
    return errorResponse(res, 500, 'Failed to fetch venues');
  }
});

app.put('/api/vendor/venues/:id', authenticateJWT, requireVendorOrAdmin, requireOwnResourceOrAdmin(Venue, 'id'), async (req, res) => {
  try {
    const [updated] = await Venue.update(req.body, { where: { id: req.params.id } });
    if (!updated) return res.status(404).json({ error: 'Venue not found' });
    const venue = await Venue.findByPk(req.params.id);
    res.json(venue);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// CRUD Additional Services for Vendor
app.post('/api/vendor/vendors/:vendorId/services', authenticateJWT, requireVendorOrAdmin, async (req, res) => {
  if (parseInt(req.params.vendorId) !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Not your vendor profile' });
  }
  try {
    // Check if venueId is provided
    if (!req.body.venueId) {
      return errorResponse(res, 400, 'venueId is required when creating an additional service');
    }
    
    // Verify that the venue exists and belongs to this vendor
    const venue = await Venue.findOne({ 
      where: { 
        id: req.body.venueId,
        vendorId: req.params.vendorId 
      }
    });
    
    if (!venue) {
      return errorResponse(res, 404, 'Venue not found or does not belong to this vendor');
    }
    
    // Create service with both vendorId and venueId
    const service = await AdditionalService.create({ 
      ...req.body, 
      vendorId: req.params.vendorId,
      venueId: req.body.venueId
    });
    
    logger.info(`User ${req.user.id} (${req.user.role}) created additional service for venue ${req.body.venueId}`);
    res.status(201).json(service);
  } catch (err) {
    logger.error(`Error creating additional service: ${err.message}`);
    return errorResponse(res, 400, 'Failed to create additional service');
  }
});

app.get('/api/vendor/vendors/:vendorId/services', async (req, res) => {
  try {
    const services = await AdditionalService.findAll({ where: { vendorId: req.params.vendorId } });
    res.json(services);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/vendor/services/:id', authenticateJWT, requireVendorOrAdmin, requireOwnResourceOrAdmin(AdditionalService, 'id'), async (req, res) => {
  try {
    const [updated] = await AdditionalService.update(req.body, { where: { id: req.params.id } });
    if (!updated) return res.status(404).json({ error: 'Service not found' });
    const service = await AdditionalService.findByPk(req.params.id);
    res.json(service);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Dashboard endpoint (summary for vendor)
app.get('/vendors/:vendorId/dashboard', async (req, res) => {
  try {
    const venues = await Venue.count({ where: { vendorId: req.params.vendorId } });
    const services = await AdditionalService.count({ where: { vendorId: req.params.vendorId } });
    res.json({ totalVenues: venues, totalServices: services });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Sync DB and start server
sequelize.sync({ alter: true }).then(() => {
  app.listen(PORT, () => {
    logger.info(`Vendor Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});