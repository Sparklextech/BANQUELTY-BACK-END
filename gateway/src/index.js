require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const winston = require('winston');

const app = express();
const PORT = process.env.GATEWAY_PORT || 4010;
const JWT_SECRET = process.env.JWT_SECRET;

// Validate JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
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

// Basic configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway' });
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many requests' });
  }
});
app.use(limiter);

// JWT validation middleware
function jwtMiddleware(req, res, next) {
  // Explicitly define public endpoints that don't require authentication
  const publicPaths = [
    '/api/health',
    '/api/auth/login', 
    '/api/auth/register'
  ];
  
  // Skip auth only for explicitly defined public endpoints with exact matching
  if (publicPaths.includes(req.path)) {
    logger.info(`Accessing public endpoint: ${req.path}`);
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Invalid or missing authorization header');
    return res.status(401).json({ error: 'Invalid or missing token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn('JWT validation failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
}
app.use(jwtMiddleware);

// Service routes
const routes = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  venue: process.env.VENUE_SERVICE_URL || 'http://localhost:4002',
  vendor: process.env.VENDOR_SERVICE_URL || 'http://localhost:4003',
  admin: process.env.ADMIN_SERVICE_URL || 'http://localhost:4004',
  booking: process.env.BOOKING_SERVICE_URL || 'http://localhost:4005',
  media: process.env.MEDIA_SERVICE_URL || 'http://localhost:4006',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4007',
  calendar: process.env.CALENDAR_SERVICE_URL || 'http://localhost:4009',
  'service-provider': process.env.SERVICE_PROVIDER_SERVICE_URL || 'http://localhost:4008'
};

// Validate service URLs
Object.entries(routes).forEach(([service, url]) => {
  if (!url) {
    throw new Error(`Environment variable for ${service} service URL is missing`);
  }
});

// Proxy configuration
Object.entries(routes).forEach(([service, target]) => {
  const proxyOptions = {
    target,
    changeOrigin: true,
    pathRewrite: {
      [`^/api/${service}`]: ''
    },
    timeout: 30000,
    proxyTimeout: 30000,
    retries: 3,
    onProxyReq: (proxyReq, req) => {
      // Create sanitized log object without sensitive information
      const sanitizedLog = {
        method: req.method,
        path: req.path,
        service,
        target: `${target}${req.path}`,
        query: Object.keys(req.query || {}).length > 0 ? 'present' : 'none'
      };
      
      // Don't log the full user object, just minimal info if present
      if (req.user) {
        sanitizedLog.userRole = req.user.role;
        sanitizedLog.authenticated = true;
      }
      
      logger.info(`Proxying request to ${service}`, sanitizedLog);

      if (req.user) {
        proxyReq.setHeader('X-User-Id', req.user.id);
        proxyReq.setHeader('X-User-Role', req.user.role);
      }

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      logger.info(`Response from ${service}`, {
        method: req.method,
        path: req.path,
        statusCode: proxyRes.statusCode
      });
      if (proxyRes.statusCode >= 400) {
        logger.warn(`Error response from ${service}`, { statusCode: proxyRes.statusCode });
      }
    },
    onError: (err, req, res) => {
      logger.error(`Proxy error for ${service}`, {
        error: err.message,
        target,
        path: req.path
      });
      if (!res.headersSent) {
        res.status(502).json({
          error: `${service} service unavailable`,
          message: 'The requested service is currently unavailable. Please try again later.'
        });
      }
    },
    logLevel: 'warn',
    ws: true,
    secure: false,
    followRedirects: true
  };

  const proxy = createProxyMiddleware(proxyOptions);
  app.use(`/api/${service}`, proxy);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`API Gateway running on port ${PORT}`);
  logger.info('Configured routes:', Object.keys(routes).map(service => `/api/${service}`));
});