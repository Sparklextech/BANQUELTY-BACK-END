 const express = require('express');
const { Venue, Category } = require('./models');
const winston = require('winston');
const router = express.Router();

// Logger reference - using the logger from the main app
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// Middleware to check if user is admin
function requireAdmin(req, res, next) {
  if (!req.user) {
    return errorResponse(res, 401, 'Authentication required');
  }
  
  if (req.user.role !== 'admin') {
    logger.warn(`User ${req.user.id} (${req.user.role}) attempted to access analytics`);
    return errorResponse(res, 403, 'Admin permissions required to access analytics');
  }
  
  next();
}

// Get total number of venues - requires admin permissions
router.get('/total-venues', requireAdmin, async (req, res) => {
  try {
    const count = await Venue.count();
    logger.info(`User ${req.user.id} (admin) retrieved total venues count: ${count}`);
    res.json({ totalVenues: count });
  } catch (err) {
    logger.error('Error retrieving total venues count:', err);
    return errorResponse(res, 500, 'Failed to retrieve total venues count');
  }
});

// Get top categories by number of venues - requires admin permissions
router.get('/top-categories', requireAdmin, async (req, res) => {
  try {
    const categories = await Category.findAll({
      include: [{ model: Venue }]
    });
    
    const result = categories.map(cat => ({
      category: cat.name,
      venueCount: cat.Venues ? cat.Venues.length : 0
    })).sort((a, b) => b.venueCount - a.venueCount);
    
    logger.info(`User ${req.user.id} (admin) retrieved top categories`);
    res.json(result);
  } catch (err) {
    logger.error('Error retrieving top categories:', err);
    return errorResponse(res, 500, 'Failed to retrieve top categories');
  }
});

// Stub: Get total bookings - requires admin permissions
router.get('/total-bookings', requireAdmin, async (req, res) => {
  try {
    // This should call booking-service or shared DB in real implementation
    // In a real implementation, we would use a message queue or direct API call
    // to fetch this data from the Booking service
    
    logger.info(`User ${req.user.id} (admin) retrieved total bookings`);
    res.json({ totalBookings: 0, note: 'Stub endpoint - would fetch from Booking service in production' });
  } catch (err) {
    logger.error('Error retrieving total bookings:', err);
    return errorResponse(res, 500, 'Failed to retrieve total bookings');
  }
});

// Stub: Get total revenue - requires admin permissions
router.get('/total-revenue', requireAdmin, async (req, res) => {
  try {
    // This should aggregate from booking-service in real implementation
    // In a real implementation, we would use a message queue or direct API call
    // to fetch this data from the Booking service
    
    logger.info(`User ${req.user.id} (admin) retrieved total revenue`);
    res.json({ totalRevenue: 0, note: 'Stub endpoint - would fetch from Booking service in production' });
  } catch (err) {
    logger.error('Error retrieving total revenue:', err);
    return errorResponse(res, 500, 'Failed to retrieve total revenue');
  }
});

// For vendor-specific analytics
// Get vendor venues statistics - requires vendor authentication
router.get('/vendor/venues', async (req, res) => {
  if (!req.user) {
    return errorResponse(res, 401, 'Authentication required');
  }
  
  if (req.user.role !== 'vendor' && req.user.role !== 'admin') {
    return errorResponse(res, 403, 'Vendor or admin permissions required');
  }
  
  try {
    // For admin, allow query parameter to specify vendor
    const vendorId = (req.user.role === 'admin' && req.query.vendorId) ? 
                      req.query.vendorId : req.user.id;
    
    const venues = await Venue.findAll({ 
      where: { vendorId },
      include: [{ model: Category }]
    });
    
    const result = {
      totalVenues: venues.length,
      categoryDistribution: {}
    };
    
    // Calculate category distribution
    venues.forEach(venue => {
      if (venue.Category) {
        const catName = venue.Category.name;
        result.categoryDistribution[catName] = (result.categoryDistribution[catName] || 0) + 1;
      }
    });
    
    logger.info(`User ${req.user.id} (${req.user.role}) retrieved vendor venue statistics for vendor ${vendorId}`);
    res.json(result);
  } catch (err) {
    logger.error(`Error retrieving vendor venue statistics:`, err);
    return errorResponse(res, 500, 'Failed to retrieve vendor venue statistics');
  }
});

module.exports = router;