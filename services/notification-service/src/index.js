require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const winston = require('winston');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.NOTIFICATION_SERVICE_PORT || 4007; // Changed from 4008 to 4007 to match gateway configuration
const JWT_SECRET = process.env.JWT_SECRET;

// Validate required environment variables
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

// Service API clients
const authService = axios.create({
  baseURL: process.env.AUTH_SERVICE_URL || 'http://auth-service:4001',
  timeout: 5000
});

// Middleware setup
app.use(cors());
app.use(bodyParser.json({
  limit: '1mb' // Limit request size to prevent DoS attacks
}));

// Error handler for JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error('JSON parsing error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON provided' });
  }
  next(err);
});

// Request logging middleware (sanitizing sensitive data)
app.use((req, res, next) => {
  const sanitizedBody = { ...req.body };
  // Sanitize any sensitive fields
  if (sanitizedBody.message) {
    sanitizedBody.message = sanitizedBody.message.length > 20 ? 
      sanitizedBody.message.substring(0, 20) + '...' : sanitizedBody.message;
  }
  
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    body: sanitizedBody
  });
  next();
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
        role: req.headers['x-user-role'],
        email: req.headers['x-user-email'] || null
      };
      return next();
    }
    
    // Fallback for direct access: Validate JWT
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logger.warn('No authorization header provided');
      return errorResponse(res, 401, 'Authentication required');
    }
    
    // Validate token format
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('Invalid authorization header format');
      return errorResponse(res, 401, 'Invalid authorization format. Format is: Bearer [token]');
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.warn('Empty token provided');
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

const Notification = sequelize.define('Notification', {
  to: { type: DataTypes.STRING, allowNull: false },
  subject: { type: DataTypes.STRING },
  message: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('sent', 'failed'), defaultValue: 'sent' },
  createdBy: { type: DataTypes.INTEGER, allowNull: true },
  readAt: { type: DataTypes.DATE, allowNull: true }
});

// Health checks
app.get('/api/notification/health', (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Create SMTP transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send notification - requires authentication and proper authorization
app.post('/api/notification/send', authenticateJWT, async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    
    // Validate required fields
    if (!to || !subject || !message) {
      return errorResponse(res, 400, 'Missing required fields', 'to, subject, and message are all required');
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return errorResponse(res, 400, 'Invalid email format');
    }
    
    // Authorization checks
    // 1. Admins can send to anyone
    // 2. Users can only send to their own email
    // 3. Vendors can only send to their own email
    let isAuthorized = false;
    
    if (req.user.role === 'admin') {
      isAuthorized = true;
    } else {
      // Check if user is sending to their own email
      if (req.user.email && to.toLowerCase() === req.user.email.toLowerCase()) {
        isAuthorized = true;
      } else {
        // For strict implementation, we'd check if the recipient is related to the sender's
        // bookings, venues, etc. by querying other services
        // For now, we're being restrictive
        isAuthorized = false;
      }
    }
    
    if (!isAuthorized) {
      logger.warn(`Unauthorized email attempt: User ${req.user.id} (${req.user.role}) tried to send to ${to}`);
      return errorResponse(res, 403, 'You are not authorized to send emails to this recipient');
    }
    
    let status = 'sent';
    
    // Log user making the request
    logger.info(`User ${req.user.id} (${req.user.role}) sending notification to ${to}`);
    
    try {
      // Check if SMTP config is available
      if (!process.env.SMTP_FROM || !process.env.SMTP_HOST) {
        logger.warn('SMTP configuration incomplete');
        status = 'failed';
        throw new Error('Email service not configured');
      }
      
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject,
        text: message,
      });
      status = 'sent';
      logger.info(`Email sent successfully to ${to}`);
    } catch (err) {
      logger.error('SMTP error:', err.message);
      status = 'failed';
    }
    
    const notification = await Notification.create({ to, subject, message, status });
    res.status(status === 'sent' ? 201 : 500).json({
      id: notification.id,
      to: notification.to,
      subject: notification.subject,
      status: notification.status,
      createdAt: notification.createdAt
    });
  } catch (err) {
    logger.error('Notification send error:', err.message);
    res.status(500).json({ error: 'Failed to process notification' });
  }
});

// Send notification through API - requires authentication and proper authorization
app.post('/api/notification/notifications', authenticateJWT, async (req, res) => {
  try {
    const { userId, type, title, message, data } = req.body;
    
    // Validate required fields
    if (!userId) {
      return errorResponse(res, 400, 'userId is required');
    }
    
    if (!message) {
      return errorResponse(res, 400, 'message is required');
    }
    
    if (!type) {
      return errorResponse(res, 400, 'notification type is required');
    }
    
    // Authorization checks
    // 1. Admins can send to anyone
    // 2. Users can only send to themselves
    // 3. Vendors can only send to users with bookings at their venues
    let isAuthorized = false;
    const targetUserId = userId.toString();
    const currentUserId = req.user.id.toString();
    
    if (req.user.role === 'admin') {
      isAuthorized = true;
    } else if (targetUserId === currentUserId) {
      // Users can send notifications to themselves
      isAuthorized = true;
    } else if (req.user.role === 'vendor') {
      // For a complete implementation, we would check if the target user has a
      // booking with this vendor by querying the Booking service
      // For now, we're being restrictive
      isAuthorized = false;
      
      // TODO: Check Booking service if user has booking with this vendor
      // const hasBooking = await checkUserHasBookingWithVendor(targetUserId, currentUserId);
      // isAuthorized = hasBooking;
    }
    
    if (!isAuthorized) {
      logger.warn(`Unauthorized notification attempt: User ${req.user.id} (${req.user.role}) tried to send to user ${userId}`);
      return errorResponse(res, 403, 'You are not authorized to send notifications to this user');
    }
    
    // Log user making the request
    logger.info(`User ${req.user.id} (${req.user.role}) sending notification to user ${userId}`);
    
    // Fetch the user's real email from auth service
    let userEmail;
    try {
      const response = await authService.get(`/api/auth/users/${userId}`, {
        headers: { 'Authorization': req.headers.authorization }
      });
      const user = response.data;
      userEmail = user.email;
      
      if (!userEmail) {
        logger.warn(`No email found for user ${userId}`);
        return errorResponse(res, 400, 'User has no email address');
      }
    } catch (authErr) {
      logger.error(`Error fetching user email: ${authErr.message}`);
      return errorResponse(res, 500, 'Error fetching user information');
    }
    
    // Add more context to the notification
    const notification = await Notification.create({ 
      to: userEmail, 
      subject: title || type, 
      message, 
      status: 'sent',
      createdBy: req.user.id
    });
    
    res.status(201).json({
      id: notification.id,
      userId,
      type,
      title,
      message: message.length > 30 ? message.substring(0, 30) + '...' : message, // Truncate for response
      status: 'sent',
      createdAt: notification.createdAt
    });
  } catch (err) {
    logger.error('Notification error:', err.message);
    res.status(500).json({ error: 'Failed to process notification' });
  }
});

// Get single notification with proper authorization
app.get('/api/notification/notifications/:id', authenticateJWT, async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);
    
    if (!notification) {
      return errorResponse(res, 404, 'Notification not found');
    }
    
    // Authorization logic
    // 1. Admins can view any notification
    // 2. Users can only view notifications created by them or sent to them
    let isAuthorized = false;
    
    if (req.user.role === 'admin') {
      isAuthorized = true;
    } else if (notification.createdBy && notification.createdBy.toString() === req.user.id.toString()) {
      // User created this notification
      isAuthorized = true;
    } else {
      // More robust check against the actual recipient
      let recipientId = null;
      
      // Try to extract user ID from the to field (format: user-[id]@example.com)
      const match = notification.to.match(/^user-([0-9]+)@/);
      if (match && match[1]) {
        recipientId = match[1];
      }
      
      // Check if current user is the recipient
      if (recipientId && recipientId === req.user.id.toString()) {
        isAuthorized = true;
        
        // Mark as read if not already
        if (!notification.readAt) {
          notification.readAt = new Date();
          await notification.save();
        }
      }
    }
    
    if (!isAuthorized) {
      logger.warn(`User ${req.user.id} attempted to access notification ${req.params.id} without permission`);
      return errorResponse(res, 403, 'You do not have permission to view this notification');
    }
    
    res.json(notification);
  } catch (err) {
    logger.error(`Get notification ${req.params.id} error:`, err.message);
    return errorResponse(res, 500, 'Failed to retrieve notification');
  }
});

// Get user's notifications
app.get('/api/notification/user/notifications', authenticateJWT, async (req, res) => {
  try {
    // Page and limit for pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Generate the user's email pattern for matching
    const emailPattern = `user-${req.user.id}@`;
    
    // Find notifications for this user
    const { count, rows: notifications } = await Notification.findAndCountAll({
      where: {
        [Sequelize.Op.or]: [
          { to: { [Sequelize.Op.like]: `${emailPattern}%` } },
          { createdBy: req.user.id }
        ]
      },
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'to', 'subject', 'status', 'createdAt', 'readAt'] // Exclude message content for security
    });
    
    // Send response with pagination info
    res.json({
      totalCount: count,
      page,
      totalPages: Math.ceil(count / limit),
      limit,
      notifications
    });
  } catch (err) {
    logger.error(`Get user notifications error:`, err.message);
    return errorResponse(res, 500, 'Failed to retrieve notifications');
  }
});

// List notifications - requires authentication and admin role
app.get('/api/notification/notifications', authenticateJWT, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      logger.warn(`User ${req.user.id} (${req.user.role}) attempted to list all notifications`);
      return res.status(403).json({ error: 'Admin role required to list all notifications' });
    }
    
    // Add pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get count and notifications
    const { count, rows: notifications } = await Notification.findAndCountAll({
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'to', 'subject', 'status', 'createdAt', 'updatedAt'] // Exclude message content for security
    });
    
    logger.info(`Admin ${req.user.id} fetched ${notifications.length} notifications (page ${page})`); 
    
    res.json({
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
      notifications
    });
  } catch (err) {
    logger.error(`Get user notifications error:`, err.message);
    return errorResponse(res, 500, 'Failed to retrieve notifications');
  }
});

// Sync DB and start server
sequelize.sync().then(() => {
  app.listen(PORT, () => {
    logger.info(`Notification Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});