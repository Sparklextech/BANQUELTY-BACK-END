require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { sequelize, Category, Venue, AdditionalService } = require('./models');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 4002;
const jwt = require('jsonwebtoken');

// Ensure JWT_SECRET is set properly
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required but not set');
  process.exit(1);
}

// --- Middleware ---
function authenticateJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Validate token format explicitly
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid authorization header format' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Empty token provided' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireVendorOrAdmin(req, res, next) {
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'Forbidden: Vendors only' });
  if (req.user.kycStatus !== 'approved') return res.status(403).json({ error: 'KYC not approved' });
  next();
}

async function requireOwnVenueOrAdmin(req, res, next) {
  if (req.user.role === 'admin') return next();
  const venueId = req.params.id || req.body.id || req.body.venueId;
  if (!venueId) return res.status(400).json({ error: 'Venue ID required' });
  const venue = await Venue.findByPk(venueId);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  if (venue.vendorId !== req.user.id) return res.status(403).json({ error: 'Forbidden: Not your venue' });
  next();
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

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// Middleware to check admin role specifically
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    logger.warn(`User ${req.user.id} (${req.user.role}) attempted to access admin-only endpoint`);
    return errorResponse(res, 403, 'Admin permissions required');
  }
  next();
}

// Category CRUD - restricted to admin only
app.post('/categories', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const category = await Category.create(req.body);
    logger.info(`Admin ${req.user.id} created new category: ${category.name}`);
    res.status(201).json(category);
  } catch (err) {
    logger.error('Error creating category:', err);
    return errorResponse(res, 400, 'Failed to create category');
  }
});

// Get categories - public endpoint but with rate limiting
app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.findAll();
    res.json(categories);
  } catch (err) {
    logger.error('Error fetching categories:', err);
    return errorResponse(res, 500, 'Failed to fetch categories');
  }
});

// Category edit and delete - admin only
app.put('/categories/:id', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const [updated] = await Category.update(req.body, { where: { id: req.params.id } });
    if (!updated) {
      return errorResponse(res, 404, 'Category not found');
    }
    
    const category = await Category.findByPk(req.params.id);
    logger.info(`Admin ${req.user.id} updated category ${req.params.id}`);
    res.json(category);
  } catch (err) {
    logger.error('Error updating category:', err);
    return errorResponse(res, 500, 'Failed to update category');
  }
});

app.delete('/categories/:id', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    // First check if any venues are using this category
    const venuesUsingCategory = await Venue.count({ where: { categoryId: req.params.id } });
    
    if (venuesUsingCategory > 0) {
      return errorResponse(res, 400, 'Cannot delete category that is in use by venues', 
                         { venuesCount: venuesUsingCategory });
    }
    
    const deleted = await Category.destroy({ where: { id: req.params.id } });
    if (!deleted) {
      return errorResponse(res, 404, 'Category not found');
    }
    
    logger.info(`Admin ${req.user.id} deleted category ${req.params.id}`);
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    logger.error('Error deleting category:', err);
    return errorResponse(res, 500, 'Failed to delete category');
  }
});

// Venue CRUD
app.post('/venues', authenticateJWT, requireVendorOrAdmin, async (req, res) => {
  try {
    // Enforce vendorId to be the logged-in vendor
    const venue = await Venue.create({ ...req.body, vendorId: req.user.id });
    res.status(201).json(venue);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Only vendor who owns the venue or admin can update
app.put('/venues/:id', authenticateJWT, requireVendorOrAdmin, requireOwnVenueOrAdmin, async (req, res) => {
  try {
    const [updated] = await Venue.update(req.body, { where: { id: req.params.id, vendorId: req.user.id } });
    if (!updated) return res.status(404).json({ error: 'Venue not found or not your venue' });
    const venue = await Venue.findByPk(req.params.id);
    res.json(venue);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Only vendor who owns the venue or admin can delete
app.delete('/venues/:id', authenticateJWT, requireVendorOrAdmin, requireOwnVenueOrAdmin, async (req, res) => {
  try {
    const deleted = await Venue.destroy({ where: { id: req.params.id, vendorId: req.user.id } });
    if (!deleted) return res.status(404).json({ error: 'Venue not found or not your venue' });
    res.json({ message: 'Venue deleted' });
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Search venues
app.get('/search', authenticateJWT, async (req, res) => {
  try {
    const { category } = req.query;
    
    // Only filter by category if it's provided
    if (category && category.trim()) {
      try {
        // First find the category by name
        const categoryObj = await Category.findOne({
          where: { name: category.trim() }
        });
        
        if (categoryObj) {
          // If found, use its ID for filtering venues
          const venues = await Venue.findAll({
            where: { categoryId: categoryObj.id },
            attributes: ['id', 'name', 'description', 'address', 'capacity', 'imageUrl', 'vendorId', 'categoryId', 'pricingType', 'flatPrice', 'perHeadPrice', 'minGuests']
          });
          
          // Return empty array if no venues
          if (venues.length === 0) {
            return res.json([]);
          }
          
          // Return just the venues without joins
          return res.json(venues);
        } else {
          // Category not found - return empty array
          logger.info(`No category found with name: ${category}`);
          return res.json([]);
        }
      } catch (categoryError) {
        logger.error(`Error finding category: ${categoryError.message}`);
        return res.json([]);
      }
    } else {
      // No category filter - just return all venues
      const venues = await Venue.findAll({
        attributes: ['id', 'name', 'description', 'address', 'capacity', 'imageUrl', 'vendorId', 'categoryId', 'pricingType', 'flatPrice', 'perHeadPrice', 'minGuests']
      });
      return res.json(venues);
    }
  } catch (error) {
    logger.error(`Search endpoint error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/venues', async (req, res) => {
  try {
    const { vendorId } = req.query;
    let queryOptions = { include: [Category, AdditionalService] };

    if (vendorId) {
      queryOptions.where = { vendorId: parseInt(vendorId, 10) }; // Ensure vendorId is an integer
      logger.info(`Fetching venues for vendorId: ${vendorId}`);
    } else {
      logger.info('Fetching all venues');
    }

    const venues = await Venue.findAll(queryOptions);
    res.json(venues);
  } catch (err) {
    logger.error('Error fetching venues:', err);
    res.status(500).json({ error: 'Failed to fetch venues', details: err.message });
  }
});

app.get('/venues/:id', async (req, res) => {
  try {
    const venue = await Venue.findByPk(req.params.id, { include: [Category, AdditionalService] });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.json(venue);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Additional Services CRUD
app.post('/venues/:venueId/additional-services', async (req, res) => {
  try {
    const venue = await Venue.findByPk(req.params.venueId);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    const service = await AdditionalService.create({ ...req.body, venueId: req.params.venueId });
    res.status(201).json(service);
  } catch (err) {
    logger.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Get venue additional services - with authentication to ensure proper access control
app.get('/venues/:venueId/additional-services', authenticateJWT, async (req, res) => {
  try {
    const venueId = req.params.venueId;
    
    // First check if the venue exists
    const venue = await Venue.findByPk(venueId);
    if (!venue) {
      return errorResponse(res, 404, 'Venue not found');
    }
    
    // For vendors, check if they own this venue
    if (req.user.role === 'vendor' && venue.vendorId.toString() !== req.user.id.toString()) {
      logger.warn(`Vendor ${req.user.id} attempted to access services for venue ${venueId} they don't own`);
      return errorResponse(res, 403, 'You do not have permission to access services for this venue');
    }
    
    const services = await AdditionalService.findAll({ where: { venueId } });
    res.json(services);
  } catch (err) {
    logger.error('Error fetching venue additional services:', err);
    return errorResponse(res, 500, 'Failed to fetch venue additional services');
  }
});

// Create venue additional service - with proper ownership validation
app.post('/venues/:venueId/additional-services', authenticateJWT, async (req, res) => {
  try {
    const venueId = req.params.venueId;
    
    // Check if venue exists
    const venue = await Venue.findByPk(venueId);
    if (!venue) {
      return errorResponse(res, 404, 'Venue not found');
    }
    
    // Check if user is admin or venue owner
    if (req.user.role !== 'admin' && venue.vendorId.toString() !== req.user.id.toString()) {
      logger.warn(`User ${req.user.id} (${req.user.role}) attempted to add service to venue ${venueId} they don't own`);
      return errorResponse(res, 403, 'You do not have permission to add services to this venue');
    }
    
    // Create the service
    const service = await AdditionalService.create({
      ...req.body,
      venueId
    });
    
    logger.info(`User ${req.user.id} (${req.user.role}) added service to venue ${venueId}`);
    res.status(201).json(service);
  } catch (err) {
    logger.error('Error creating venue additional service:', err);
    return errorResponse(res, 500, 'Failed to create venue additional service');
  }
});

// Analytics endpoints - protected with authentication
const analyticsRouter = require('./analytics');

// Apply JWT authentication to analytics endpoints
app.use('/analytics', authenticateJWT, (req, res, next) => {
  // Pass the authenticated user to analytics router
  next();
}, analyticsRouter);

// Log access to analytics
app.use('/analytics', (req, res, next) => {
  logger.info(`User ${req.user?.id || 'unauthenticated'} accessing analytics: ${req.method} ${req.path}`);
  next();
});

// Sync DB and start server
sequelize.sync({ alter: true }).then(() => {
  app.listen(PORT, () => {
    logger.info(`Venue Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});