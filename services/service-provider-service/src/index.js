require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { sequelize, ServiceProviderCategory, ServiceProviderProfile, PricingPlan, PortfolioItem } = require('./models');
const winston = require('winston');
const jwt = require('jsonwebtoken');

// Import route handlers
const quoteRoutes = require('./routes/quotes');
const chatRoutes = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 4008; // Using port 4008, verify this doesn't conflict with other services

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

// Middleware to check if user is authenticated and has appropriate role
function requireServiceProviderOrAdmin(req, res, next) {
  if (req.user.role === 'admin') return next();
  if (req.user.role !== 'service_provider') return res.status(403).json({ error: 'Forbidden: Service Providers only' });
  if (req.user.kycStatus !== 'approved') return res.status(403).json({ error: 'KYC not approved' });
  next();
}

// Middleware to check if user is trying to access their own profile
async function requireOwnProfileOrAdmin(req, res, next) {
  if (req.user.role === 'admin') return next();
  
  const profileId = req.params.id || req.body.id || req.body.profileId;
  if (!profileId) return res.status(400).json({ error: 'Profile ID required' });
  
  const profile = await ServiceProviderProfile.findByPk(profileId);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  
  if (profile.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden: Not your profile' });
  next();
}

// Middleware to check admin role specifically
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    logger.warn(`User ${req.user.id} (${req.user.role}) attempted to access admin-only endpoint`);
    return errorResponse(res, 403, 'Admin permissions required');
  }
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
app.use(cors());

// Health check endpoints - providing multiple paths for compatibility
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/service-provider/health', (req, res) => res.json({ status: 'ok' }));

// Use route handlers
app.use('/api/service-provider/quotes', quoteRoutes);
app.use('/api/service-provider/chat', chatRoutes);


// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// ===== API Routes =====

// === Category Management (Admin only) ===

// Create category
app.post('/categories', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const category = await ServiceProviderCategory.create(req.body);
    logger.info(`Admin ${req.user.id} created new service provider category: ${category.name}`);
    res.status(201).json(category);
  } catch (err) {
    logger.error('Error creating category:', err);
    return errorResponse(res, 400, 'Failed to create category', err.message);
  }
});

// Get all categories (public endpoint)
app.get('/categories', async (req, res) => {
  try {
    const categories = await ServiceProviderCategory.findAll({
      include: [
        { model: ServiceProviderCategory, as: 'parent' },
        { model: ServiceProviderCategory, as: 'children' }
      ]
    });
    res.json(categories);
  } catch (err) {
    logger.error('Error fetching categories:', err);
    return errorResponse(res, 500, 'Failed to fetch categories');
  }
});

// Update category (admin only)
app.put('/categories/:id', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const [updated] = await ServiceProviderCategory.update(req.body, { where: { id: req.params.id } });
    if (!updated) {
      return errorResponse(res, 404, 'Category not found');
    }
    
    const category = await ServiceProviderCategory.findByPk(req.params.id);
    logger.info(`Admin ${req.user.id} updated service provider category ${req.params.id}`);
    res.json(category);
  } catch (err) {
    logger.error('Error updating category:', err);
    return errorResponse(res, 500, 'Failed to update category');
  }
});

// Delete category (admin only)
app.delete('/categories/:id', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    // First check if any profiles are using this category
    const profilesUsingCategory = await ServiceProviderProfile.count({ 
      where: { primaryServiceCategoryId: req.params.id } 
    });
    
    if (profilesUsingCategory > 0) {
      return errorResponse(res, 400, 'Cannot delete category in use by profiles');
    }
    
    // Also check subcategories
    const profilesUsingSubcategory = await ServiceProviderProfile.count({
      include: [{
        model: ServiceProviderCategory,
        as: 'subcategories',
        where: { id: req.params.id }
      }]
    });
    
    if (profilesUsingSubcategory > 0) {
      return errorResponse(res, 400, 'Cannot delete category in use by profiles as subcategory');
    }
    
    // Check if has child categories
    const childCategories = await ServiceProviderCategory.count({
      where: { parentId: req.params.id }
    });
    
    if (childCategories > 0) {
      return errorResponse(res, 400, 'Cannot delete category with child categories');
    }
    
    const deleted = await ServiceProviderCategory.destroy({ where: { id: req.params.id } });
    if (!deleted) {
      return errorResponse(res, 404, 'Category not found');
    }
    
    logger.info(`Admin ${req.user.id} deleted service provider category ${req.params.id}`);
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    logger.error('Error deleting category:', err);
    return errorResponse(res, 500, 'Failed to delete category');
  }
});

// === Service Provider Profile Management ===

// Create profile (service_provider only)
app.post('/profiles', authenticateJWT, async (req, res) => {
  try {
    // Validate user role
    if (req.user.role !== 'service_provider' && req.user.role !== 'admin') {
      return errorResponse(res, 403, 'Only service providers or admins can create profiles');
    }
    
    // Check if profile already exists for this user
    const existingProfile = await ServiceProviderProfile.findOne({ where: { userId: req.user.id } });
    if (existingProfile && req.user.role === 'service_provider') {
      return errorResponse(res, 400, 'Profile already exists for this user');
    }
    
    // Force userId to be the authenticated user's ID if not admin
    const data = { ...req.body };
    if (req.user.role !== 'admin') {
      data.userId = req.user.id;
    }
    
    const profile = await ServiceProviderProfile.create(data);
    
    // If subcategories are provided, associate them
    if (req.body.subcategoryIds && Array.isArray(req.body.subcategoryIds)) {
      const subcategories = await ServiceProviderCategory.findAll({
        where: { id: req.body.subcategoryIds }
      });
      await profile.setSubcategories(subcategories);
    }
    
    logger.info(`User ${req.user.id} created new service provider profile: ${profile.id}`);
    res.status(201).json(profile);
  } catch (err) {
    logger.error('Error creating profile:', err);
    return errorResponse(res, 400, 'Failed to create profile', err.message);
  }
});

// Get all profiles (public)
app.get('/profiles', async (req, res) => {
  try {
    const { categoryId } = req.query;
    let queryOptions = {
      include: [
        { model: ServiceProviderCategory, as: 'primaryCategory' },
        { model: ServiceProviderCategory, as: 'subcategories' },
        { model: PricingPlan, as: 'pricingPlans' }
      ]
    };
    
    if (categoryId) {
      // Either the primary category or a subcategory matches
      queryOptions.where = {
        [Sequelize.Op.or]: [
          { primaryServiceCategoryId: categoryId },
          { '$subcategories.id$': categoryId }
        ]
      };
    }
    
    const profiles = await ServiceProviderProfile.findAll(queryOptions);
    res.json(profiles);
  } catch (err) {
    logger.error('Error fetching profiles:', err);
    return errorResponse(res, 500, 'Failed to fetch profiles');
  }
});

// Get specific profile (public)
app.get('/profiles/:id', async (req, res) => {
  try {
    const profile = await ServiceProviderProfile.findByPk(req.params.id, {
      include: [
        { model: ServiceProviderCategory, as: 'primaryCategory' },
        { model: ServiceProviderCategory, as: 'subcategories' },
        { model: PricingPlan, as: 'pricingPlans' },
        { model: PortfolioItem, as: 'portfolioItems' }
      ]
    });
    
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }
    
    res.json(profile);
  } catch (err) {
    logger.error('Error fetching profile:', err);
    return errorResponse(res, 500, 'Failed to fetch profile');
  }
});

// Update profile (own profile or admin)
app.put('/profiles/:id', authenticateJWT, requireOwnProfileOrAdmin, async (req, res) => {
  try {
    const [updated] = await ServiceProviderProfile.update(req.body, { 
      where: { id: req.params.id } 
    });
    
    if (!updated) {
      return errorResponse(res, 404, 'Profile not found');
    }
    
    const profile = await ServiceProviderProfile.findByPk(req.params.id);
    
    // If subcategories are provided, update associations
    if (req.body.subcategoryIds && Array.isArray(req.body.subcategoryIds)) {
      const subcategories = await ServiceProviderCategory.findAll({
        where: { id: req.body.subcategoryIds }
      });
      await profile.setSubcategories(subcategories);
    }
    
    logger.info(`User ${req.user.id} updated service provider profile: ${profile.id}`);
    res.json(profile);
  } catch (err) {
    logger.error('Error updating profile:', err);
    return errorResponse(res, 500, 'Failed to update profile');
  }
});

// === Pricing Plan Management ===

// Create pricing plan
app.post('/profiles/:profileId/pricing-plans', authenticateJWT, requireOwnProfileOrAdmin, async (req, res) => {
  try {
    const profile = await ServiceProviderProfile.findByPk(req.params.profileId);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }
    
    const plan = await PricingPlan.create({
      ...req.body,
      serviceProviderProfileId: req.params.profileId
    });
    
    logger.info(`User ${req.user.id} created new pricing plan: ${plan.id} for profile: ${req.params.profileId}`);
    res.status(201).json(plan);
  } catch (err) {
    logger.error('Error creating pricing plan:', err);
    return errorResponse(res, 400, 'Failed to create pricing plan', err.message);
  }
});

// Get all pricing plans for a profile
app.get('/profiles/:profileId/pricing-plans', async (req, res) => {
  try {
    const plans = await PricingPlan.findAll({
      where: { serviceProviderProfileId: req.params.profileId }
    });
    
    res.json(plans);
  } catch (err) {
    logger.error('Error fetching pricing plans:', err);
    return errorResponse(res, 500, 'Failed to fetch pricing plans');
  }
});

// Update pricing plan
app.put('/pricing-plans/:id', authenticateJWT, async (req, res) => {
  try {
    // First check if the plan exists and belongs to a profile owned by the user
    const plan = await PricingPlan.findByPk(req.params.id, {
      include: [{ model: ServiceProviderProfile, as: 'serviceProviderProfile' }]
    });
    
    if (!plan) {
      return errorResponse(res, 404, 'Pricing plan not found');
    }
    
    // Check ownership
    if (req.user.role !== 'admin' && plan.serviceProviderProfile.userId !== req.user.id) {
      return errorResponse(res, 403, 'Not authorized to update this pricing plan');
    }
    
    const [updated] = await PricingPlan.update(req.body, { 
      where: { id: req.params.id } 
    });
    
    if (!updated) {
      return errorResponse(res, 404, 'Pricing plan not found');
    }
    
    const updatedPlan = await PricingPlan.findByPk(req.params.id);
    logger.info(`User ${req.user.id} updated pricing plan: ${updatedPlan.id}`);
    res.json(updatedPlan);
  } catch (err) {
    logger.error('Error updating pricing plan:', err);
    return errorResponse(res, 500, 'Failed to update pricing plan');
  }
});

// Delete pricing plan
app.delete('/pricing-plans/:id', authenticateJWT, async (req, res) => {
  try {
    // First check if the plan exists and belongs to a profile owned by the user
    const plan = await PricingPlan.findByPk(req.params.id, {
      include: [{ model: ServiceProviderProfile, as: 'serviceProviderProfile' }]
    });
    
    if (!plan) {
      return errorResponse(res, 404, 'Pricing plan not found');
    }
    
    // Check ownership
    if (req.user.role !== 'admin' && plan.serviceProviderProfile.userId !== req.user.id) {
      return errorResponse(res, 403, 'Not authorized to delete this pricing plan');
    }
    
    const deleted = await PricingPlan.destroy({ where: { id: req.params.id } });
    if (!deleted) {
      return errorResponse(res, 404, 'Pricing plan not found');
    }
    
    logger.info(`User ${req.user.id} deleted pricing plan ${req.params.id}`);
    res.json({ message: 'Pricing plan deleted successfully' });
  } catch (err) {
    logger.error('Error deleting pricing plan:', err);
    return errorResponse(res, 500, 'Failed to delete pricing plan');
  }
});

// === Portfolio Management ===

// Upload portfolio item
app.post('/profiles/:profileId/portfolio', authenticateJWT, requireOwnProfileOrAdmin, async (req, res) => {
  try {
    const profile = await ServiceProviderProfile.findByPk(req.params.profileId);
    if (!profile) {
      return errorResponse(res, 404, 'Profile not found');
    }
    
    // Clients will usually upload media to media-service first and get URLs back
    // Then send those URLs in the request body to this endpoint
    const item = await PortfolioItem.create({
      ...req.body,
      profileId: req.params.profileId
    });
    
    logger.info(`User ${req.user.id} added portfolio item: ${item.id} to profile: ${req.params.profileId}`);
    res.status(201).json(item);
  } catch (err) {
    logger.error('Error creating portfolio item:', err);
    return errorResponse(res, 400, 'Failed to create portfolio item', err.message);
  }
});

// Get all portfolio items for a profile
app.get('/profiles/:profileId/portfolio', async (req, res) => {
  try {
    const items = await PortfolioItem.findAll({
      where: { profileId: req.params.profileId },
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']]
    });
    
    res.json(items);
  } catch (err) {
    logger.error('Error fetching portfolio items:', err);
    return errorResponse(res, 500, 'Failed to fetch portfolio items');
  }
});

// Update portfolio item
app.put('/portfolio/:id', authenticateJWT, async (req, res) => {
  try {
    // First check if the item exists and belongs to a profile owned by the user
    const item = await PortfolioItem.findByPk(req.params.id, {
      include: [{ model: ServiceProviderProfile, as: 'serviceProviderProfile' }]
    });
    
    if (!item) {
      return errorResponse(res, 404, 'Portfolio item not found');
    }
    
    // Check ownership
    if (req.user.role !== 'admin' && item.serviceProviderProfile.userId !== req.user.id) {
      return errorResponse(res, 403, 'Not authorized to update this portfolio item');
    }
    
    const [updated] = await PortfolioItem.update(req.body, { 
      where: { id: req.params.id } 
    });
    
    if (!updated) {
      return errorResponse(res, 404, 'Portfolio item not found');
    }
    
    const updatedItem = await PortfolioItem.findByPk(req.params.id);
    logger.info(`User ${req.user.id} updated portfolio item: ${updatedItem.id}`);
    res.json(updatedItem);
  } catch (err) {
    logger.error('Error updating portfolio item:', err);
    return errorResponse(res, 500, 'Failed to update portfolio item');
  }
});

// Delete portfolio item
app.delete('/portfolio/:id', authenticateJWT, async (req, res) => {
  try {
    // First check if the item exists and belongs to a profile owned by the user
    const item = await PortfolioItem.findByPk(req.params.id, {
      include: [{ model: ServiceProviderProfile, as: 'serviceProviderProfile' }]
    });
    
    if (!item) {
      return errorResponse(res, 404, 'Portfolio item not found');
    }
    
    // Check ownership
    if (req.user.role !== 'admin' && item.serviceProviderProfile.userId !== req.user.id) {
      return errorResponse(res, 403, 'Not authorized to delete this portfolio item');
    }
    
    const deleted = await PortfolioItem.destroy({ where: { id: req.params.id } });
    if (!deleted) {
      return errorResponse(res, 404, 'Portfolio item not found');
    }
    
    logger.info(`User ${req.user.id} deleted portfolio item ${req.params.id}`);
    res.json({ message: 'Portfolio item deleted successfully' });
  } catch (err) {
    logger.error('Error deleting portfolio item:', err);
    return errorResponse(res, 500, 'Failed to delete portfolio item');
  }
});

// === Admin KYC Management ===

// Update KYC status (admin only)
app.put('/profiles/:id/kyc', authenticateJWT, requireAdmin, async (req, res) => {
  try {
    const { kycStatus } = req.body;
    
    if (!['pending', 'submitted', 'approved', 'rejected'].includes(kycStatus)) {
      return errorResponse(res, 400, 'Invalid KYC status');
    }
    
    const [updated] = await ServiceProviderProfile.update(
      { kycStatus }, 
      { where: { id: req.params.id } }
    );
    
    if (!updated) {
      return errorResponse(res, 404, 'Profile not found');
    }
    
    const profile = await ServiceProviderProfile.findByPk(req.params.id);
    logger.info(`Admin ${req.user.id} updated KYC status to ${kycStatus} for profile: ${req.params.id}`);
    res.json({ message: `KYC status updated to ${kycStatus}`, profile });
    
    // TODO: Trigger notification to service provider about KYC status change
  } catch (err) {
    logger.error('Error updating KYC status:', err);
    return errorResponse(res, 500, 'Failed to update KYC status');
  }
});

// Start the server
let server;
sequelize.sync({ alter: true }).then(() => {
  server = app.listen(PORT, () => {
    logger.info(`Service Provider Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      // Close database connection
      sequelize.close().then(() => {
        logger.info('Database connection closed');
        process.exit(0);
      }).catch(err => {
        logger.error('Error closing database connection:', err);
        process.exit(1);
      });
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      // Close database connection
      sequelize.close().then(() => {
        logger.info('Database connection closed');
        process.exit(0);
      }).catch(err => {
        logger.error('Error closing database connection:', err);
        process.exit(1);
      });
    });
  } else {
    process.exit(0);
  }
});
