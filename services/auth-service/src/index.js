require('dotenv').config();

// Import dependencies
const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const winston = require('winston');

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || 4001;

// Logger setup
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Ensure JWT_SECRET is set - don't use hardcoded values
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('JWT_SECRET environment variable is required but not set');
  process.exit(1); // Fail fast
}

// Global error handlers
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  // For production, we might want to restart the service
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  // For production, we might want to log more details
});

// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// Middleware setup
app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Add body parsing error handling first to catch JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error('JSON parsing error:', err);
    return res.status(400).json({ error: 'Invalid JSON format' });
  }
  next(err);
});



// Request logging middleware
app.use((req, res, next) => {
  logger.debug('Incoming request', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body
  });
  next();
});

// Sequelize connection with retries
const connectWithRetry = async (retries = 5, interval = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const sequelize = new Sequelize(
        process.env.POSTGRES_DB || 'banquet_db',
        process.env.POSTGRES_USER || 'postgres',
        process.env.POSTGRES_PASSWORD || 'postgres',
        {
          host: process.env.POSTGRES_HOST || 'postgres',
          dialect: 'postgres',
          logging: false,
          pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000
          }
        }
      );
      await sequelize.authenticate();
      logger.info('Database connection established');
      return sequelize;
    } catch (error) {
      logger.error(`Database connection attempt ${i + 1} failed:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
};

// User model
let User;  // Declare User at the top level

const initializeUserModel = (sequelize) => {
  const User = sequelize.define('User', {
    name: { 
      type: DataTypes.STRING, 
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    email: { 
      type: DataTypes.STRING, 
      allowNull: false, 
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password: { 
      type: DataTypes.STRING, 
      allowNull: false,
      validate: {
        len: [6, 100]
      }
    },
    role: { 
      type: DataTypes.STRING,
      defaultValue: 'user',
      validate: {
        isIn: [['user', 'vendor', 'admin', 'service_provider']]
      }
    },
    kycStatus: { 
      type: DataTypes.ENUM('pending', 'approved', 'rejected'), 
      defaultValue: 'pending'
    },
    kycDetails: { 
      type: DataTypes.JSONB, 
      allowNull: true 
    }
  }, {
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 10);
        }
      }
    }
  });
  return User;
};

// Health check
app.get('/api/auth/health', (req, res) => res.json({ status: 'ok' }));

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    // Log minimal information for security purposes
    logger.info('Register request received', { 
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length']
    });
    
    // Validate required fields
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      logger.warn('Missing required fields for registration');
      return errorResponse(res, 400, 'Name, email and password are required');
    }
    
    // Basic validation for email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logger.warn('Invalid email format during registration');
      return errorResponse(res, 400, 'Invalid email format');
    }
    
    // Password strength validation
    if (password.length < 8) {
      logger.warn('Password too short during registration');
      return errorResponse(res, 400, 'Password must be at least 8 characters long');
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      logger.warn(`Registration failed: Email already exists`);
      return errorResponse(res, 409, 'User with this email already exists');
    }
    
    // Create user with proper error handling
    // Password will be hashed automatically by the User model's beforeCreate hook
    const user = await User.create({
      name, 
      email,
      password: password, // No need to hash here, the hook will do it
      role: role || 'user'
    });
    
    logger.info(`User registered successfully with ID: ${user.id}`);
    res.status(201).json({ 
      id: user.id, 
      name: user.name, 
      email: user.email, 
      role: user.role 
    });
  } catch (err) {
    console.error('Registration error:', err);
    logger.error('Registration error', {
      error: err.message,
      stack: err.stack,
      email: req.body?.email
    });
    
    // Handle Sequelize validation errors
    if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
      console.log('Detailed validation error:', JSON.stringify(err, null, 2));
      console.log('Error name:', err.name);
      console.log('Error message:', err.message);
      if (err.errors) {
        console.log('Validation errors:');
        err.errors.forEach((e, i) => {
          console.log(`Error ${i + 1}:`, e.message, 'on field:', e.path, 'value:', e.value);
        });
      }
      
      return errorResponse(
        res, 
        400, 
        'Validation error', 
        err.errors ? err.errors.map(e => `${e.path}: ${e.message}`) : [err.message]
      );
    }
    
    return errorResponse(res, 500, 'Internal server error during registration');
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Redact the email in logs to show only domain for privacy
    const emailDomain = email ? email.split('@')[1] : 'unknown';
    logger.info(`Login attempt from domain: ${emailDomain}`);
    
    if (!email || !password) {
      logger.warn('Login failed: Email or password missing.');
      return errorResponse(res, 400, 'Email and password are required');
    }
    
    logger.debug(`Querying database for user login attempt`);
    const user = await User.findOne({ where: { email } });
    logger.debug(`Database query completed. User found: ${!!user}`);
    
    if (!user) {
      // Don't reveal whether the email exists for security
      logger.warn(`Login failed: Invalid credentials`);
      return errorResponse(res, 401, 'Invalid credentials');
    }
    
    logger.debug(`Comparing password for login attempt`);
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      logger.warn(`Login failed: Invalid password`);
      // Add a slight delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 200 + Math.floor(Math.random() * 200)));
      return errorResponse(res, 401, 'Invalid credentials');
    }
    
    logger.debug(`Generating JWT for user ID: ${user.id}`);
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        kycStatus: user.kycStatus,
        // Don't include full email in JWT, just an identifier
        email: user.email.charAt(0) + '***@' + email.split('@')[1],
        name: user.name // Include name for display purposes
      }, 
      JWT_SECRET, 
      { expiresIn: '1d' }
    );
    logger.info(`Login successful for user ID: ${user.id}`);
    
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email, 
        role: user.role, 
        kycStatus: user.kycStatus 
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    logger.error(`Login error for email ${req.body?.email}: ${err.message}`, { stack: err.stack });
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Validate token
app.get('/api/auth/validate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Check if token exists
    if (!authHeader) {
      logger.warn('Token validation failed: No authorization header');
      return errorResponse(res, 401, 'No token provided');
    }
    
    // Validate token format explicitly
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('Token validation failed: Invalid authorization format');
      return errorResponse(res, 401, 'Invalid authorization format. Format is: Bearer [token]');
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.warn('Token validation failed: Empty token');
      return errorResponse(res, 401, 'Empty token provided');
    }
    
    // Verify the token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if user still exists and is active in the database
    const user = await User.findByPk(decoded.id);
    if (!user) {
      logger.warn(`Token validation failed: User ID ${decoded.id} no longer exists`);
      return errorResponse(res, 401, 'User not found');
    }
    
    logger.info(`Token validated for user ID: ${decoded.id}`);
    
    // Return minimal necessary user information
    res.json({ 
      valid: true, 
      user: {
        id: decoded.id,
        role: decoded.role,
        kycStatus: user.kycStatus // Use fresh data from the database
      }
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      logger.warn(`Token validation error: ${err.message}`);
      return errorResponse(res, 401, 'Invalid token');
    } else if (err.name === 'TokenExpiredError') {
      logger.warn('Token validation error: Token expired');
      return errorResponse(res, 401, 'Token expired');
    } else {
      logger.error(`Token validation error: ${err.message}`, { stack: err.stack });
      return errorResponse(res, 500, 'Error validating token');
    }
  }
});

// Admin middleware
function requireAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      logger.warn('Admin authorization failed: No token provided');
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      logger.warn('Admin authorization failed: Not an admin');
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    logger.error(`Admin authorization error: ${err.message}`);
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get all users
app.get('/api/auth/users', async (req, res) => {
  try {
    // Get query parameters for filtering
    const { role, kycStatus } = req.query;
    
    // Build where clause based on filters
    const whereClause = {};
    if (role && ['user', 'vendor', 'admin'].includes(role)) {
      whereClause.role = role;
    }
    if (kycStatus && ['pending', 'approved', 'rejected'].includes(kycStatus)) {
      whereClause.kycStatus = kycStatus;
    }
    
    // Fetch users with filters and without returning password
    const users = await User.findAll({
      where: whereClause,
      attributes: ['id', 'name', 'email', 'role', 'kycStatus', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']]
    });
    
    logger.info(`Fetched ${users.length} users`);
    res.json(users);
  } catch (err) {
    logger.error(`Get all users error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user (admin only)
app.put('/api/auth/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { kycStatus, role } = req.body;
    
    // Validate allowed fields
    const allowedUpdates = {};
    if (kycStatus && ['pending', 'approved', 'rejected'].includes(kycStatus)) {
      allowedUpdates.kycStatus = kycStatus;
    }
    if (role && ['user', 'vendor', 'admin'].includes(role)) {
      allowedUpdates.role = role;
    }
    // Removed reference to non-existent 'status' field
    
    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    const [updated] = await User.update(allowedUpdates, { where: { id: userId } });
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = await User.findByPk(userId, { 
      attributes: ['id', 'name', 'email', 'role', 'kycStatus', 'createdAt', 'updatedAt']
    });
    
    logger.info(`User ${userId} updated by admin ${req.user.id}`);
    res.json(user);
  } catch (err) {
    logger.error(`Update user error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a catch-all route for unmatched paths
app.use((req, res) => {
  logger.warn(`Unmatched route: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware (moved to the end)
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestBody: req.body,
    requestUrl: req.originalUrl,
    requestMethod: req.method
  });
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function initialize() {
  try {
    // Connect to database
    const sequelize = await connectWithRetry();
    
    // Initialize User model
    User = initializeUserModel(sequelize);
    
    // Sync database schema
    await sequelize.sync({ force: false });
    logger.info('Database synchronized (force: false, tables preserved)');
    
    // Start server only after database initialization
    app.listen(PORT, () => {
      logger.info(`Auth Service running on port ${PORT}`);
      logger.info('Available endpoints:');
      logger.info('- GET /api/auth/health - Health check');
      logger.info('- POST /api/auth/register - Register new user');
      logger.info('- POST /api/auth/login - User login');
      logger.info('- GET /api/auth/validate - Validate JWT token');
    });
  } catch (err) {
    logger.error('Failed to initialize service:', err);
    process.exit(1);
  }
}

// Initialize the service
initialize();