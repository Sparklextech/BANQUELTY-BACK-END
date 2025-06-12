require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const winston = require('winston');
const axios = require('axios');

const app = express();
const PORT = process.env.MEDIA_SERVICE_PORT || 4006;
const jwt = require('jsonwebtoken');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Ensure JWT_SECRET is properly set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('JWT_SECRET environment variable is required but not set');
  throw new Error('JWT_SECRET environment variable is required');
}

// Standard error response format
function errorResponse(res, status, message, details = null) {
  const response = { error: message };
  if (details) response.details = details;
  return res.status(status).json(response);
}

// --- Middleware ---
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
      logger.warn('No authorization header provided');
      return errorResponse(res, 401, 'Authentication required');
    }
    
    // Validate token format explicitly
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('Invalid authorization header format');
      return errorResponse(res, 401, 'Invalid authorization format. Format is: Bearer [token]');
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.warn('Empty token provided');
      return errorResponse(res, 401, 'Empty token provided');
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        logger.warn(`JWT verification failed: ${err.message}`);
        return errorResponse(res, 401, 'Invalid token');
      }
      req.user = decoded;
      logger.info(`Authenticated user ${decoded.id} (${decoded.role})`);
      next();
    });
  } catch (err) {
    logger.error(`Authentication error: ${err.message}`);
    return errorResponse(res, 500, 'Internal server error during authentication');
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

// Media ownership verification middleware
async function requireMediaOwnership(req, res, next) {
  try {
    const mediaId = req.params.id;
    if (!mediaId) {
      return errorResponse(res, 400, 'Media ID is required');
    }
    
    // Admin can access all media
    if (req.user.role === 'admin') {
      return next();
    }
    
    const media = await Media.findByPk(mediaId);
    if (!media) {
      return errorResponse(res, 404, 'Media not found');
    }
    
    // Check if user owns the reference (booking, venue, etc)
    if (media.reference_type === 'booking') {
      // Verify if user owns the booking
      if (media.created_by === req.user.id) {
        return next();
      }
      
      // TODO: For more robust authorization, we should check if user owns the actual booking
      // This would require a request to the Booking service or a shared database
      // For now, we're relying on the created_by field
    }
    else if (media.reference_type === 'venue') {
      // Verify if user owns the venue
      if (req.user.role === 'vendor' && media.created_by === req.user.id) {
        return next();
      }
      
      // TODO: For more robust authorization, we should verify venue ownership via the Venue service
    }
    else if (media.reference_type === 'profile') {
      // Users can access their own profile media
      if (media.reference_id === req.user.id || media.created_by === req.user.id) {
        return next();
      }
    }
    
    logger.warn(`User ${req.user.id} attempted to access media ${mediaId} without permission`);
    return errorResponse(res, 403, 'You do not have permission to access this media');
  } catch (err) {
    logger.error(`Media ownership check error: ${err.message}`);
    return errorResponse(res, 500, 'Error verifying media ownership');
  }
}

// Service API clients
const venueService = axios.create({
  baseURL: process.env.VENUE_SERVICE_URL || 'http://venue-service:4002',
  timeout: 5000
});

const bookingService = axios.create({
  baseURL: process.env.BOOKING_SERVICE_URL || 'http://booking-service:4005',
  timeout: 5000
});

// Upload directory setup

app.use(express.json());

// Ensure uploads directory exists - use environment variable or absolute path
const uploadDir = process.env.UPLOAD_DIR || path.resolve(path.join(__dirname, '../../uploads'));

// Log the upload directory path for debugging
logger.info(`Media uploads will be stored in: ${uploadDir}`);

// Create the directory if it doesn't exist
if (!fs.existsSync(uploadDir)) {
  logger.info(`Creating upload directory: ${uploadDir}`);
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    logger.error(`Failed to create upload directory: ${err.message}`);
    throw new Error(`Failed to create upload directory: ${err.message}`);
  }
}

// File type validation
const fileFilter = (req, file, cb) => {
  // Allowed MIME types
  const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/mpeg', 'video/quicktime',
    'application/pdf'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    logger.warn(`Rejected file upload of type: ${file.mimetype}`);
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

// Multer storage setup with security enhancements
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent path traversal attacks
    const sanitizedFilename = path.basename(file.originalname).replace(/[^a-zA-Z0-9.]/g, '-');
    const uniqueFilename = `${Date.now()}-${sanitizedFilename}`;
    cb(null, uniqueFilename);
  }
});

// Enhanced multer configuration
const upload = multer({ 
  storage, 
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter
});

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

const Media = sequelize.define('Media', {
  referenceId: { type: DataTypes.STRING, allowNull: false },
  referenceType: { type: DataTypes.STRING, allowNull: false },
  mediaType: { type: DataTypes.ENUM('image', 'video', 'other'), allowNull: false },
  url: { type: DataTypes.STRING, allowNull: false },
  filename: { type: DataTypes.STRING, allowNull: false },
  mimetype: { type: DataTypes.STRING, allowNull: false },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
  isPublic: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/media/health', (req, res) => res.json({ status: 'ok' }));

// Handle multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    logger.error('Multer error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the 5MB limit' });
    }
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  } else if (err) {
    logger.error('Express error:', err);
    return res.status(500).json({ error: err.message });
  }
  next();
});

// Upload media with enhanced security
app.post('/api/media/upload', authenticateJWT, async (req, res) => {
  // Using single file upload in a separate middleware to handle errors better
  upload.single('file')(req, res, async (err) => {
    if (err) {
      logger.error('Upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    
    try {
      const { reference_id, reference_type, media_type } = req.body;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      if (!reference_id) {
        // Remove uploaded file if validation fails
        try { fs.unlinkSync(file.path); } catch (e) {}
        return res.status(400).json({ error: 'Missing reference_id parameter' });
      }
      
      if (!reference_type) {
        // Remove uploaded file if validation fails
        try { fs.unlinkSync(file.path); } catch (e) {}
        return res.status(400).json({ error: 'Missing reference_type parameter' });
      }
      
      // Validate reference_type is one of the allowed types
      const validReferenceTypes = ['venue', 'booking', 'user'];
      if (!validReferenceTypes.includes(reference_type)) {
        // Remove uploaded file if validation fails
        try { fs.unlinkSync(file.path); } catch (e) {}
        return res.status(400).json({ 
          error: 'Invalid reference_type', 
          message: `reference_type must be one of: ${validReferenceTypes.join(', ')}` 
        });
      }
      
      // Verify ownership based on reference type
      if (req.user.role !== 'admin') {
        try {
          // Case 1: Venue media - check if user is the venue owner
          if (reference_type === 'venue') {
            if (req.user.role !== 'vendor') {
              fs.unlinkSync(file.path);
              return errorResponse(res, 403, 'Only venue owners can upload media for venues');
            }
            
            // Verify venue ownership via venue service
            const response = await venueService.get(`/api/venue/venues/${reference_id}`, {
              headers: { 'Authorization': req.headers.authorization }
            });
            
            const venue = response.data;
            if (venue.vendorId.toString() !== req.user.id.toString()) {
              fs.unlinkSync(file.path);
              return errorResponse(res, 403, 'You do not have permission to upload media for this venue');
            }
          } 
          // Case 2: Booking media - check if user is involved in the booking
          else if (reference_type === 'booking') {
            const response = await bookingService.get(`/api/booking/bookings/${reference_id}`, {
              headers: { 'Authorization': req.headers.authorization }
            });
            
            const booking = response.data;
            if (booking.userId.toString() !== req.user.id.toString()) {
              fs.unlinkSync(file.path);
              return errorResponse(res, 403, 'You do not have permission to upload media for this booking');
            }
          } 
          // Case 3: User media - check if user is uploading to their own profile
          else if (reference_type === 'user' && reference_id.toString() !== req.user.id.toString()) {
            fs.unlinkSync(file.path);
            return errorResponse(res, 403, 'You can only upload media for your own user profile');
          }
        } catch (err) {
          fs.unlinkSync(file.path);
          logger.error(`Ownership verification error: ${err.message}`);
          return errorResponse(res, 500, 'Error verifying resource ownership');
        }
      }

      // Determine media type from file or use provided media_type
      const detectedMediaType = file.mimetype.startsWith('image/')
        ? 'image'
        : file.mimetype.startsWith('video/')
        ? 'video'
        : 'other';
      
      const finalMediaType = media_type || detectedMediaType;
      const url = `/uploads/${file.filename}`;
      
      // Additional security check
      if (finalMediaType === 'other' && req.user.role !== 'admin') {
        // Only admins can upload 'other' type files
        try { fs.unlinkSync(file.path); } catch (e) {}
        return res.status(403).json({ error: 'Only admins can upload this file type' });
      }
      
      // Determine if the media should be public based on reference type
      // For example, venue images might be public, but booking documents private
      const isPublic = ['venue'].includes(reference_type);
      
      const media = await Media.create({
        referenceId: reference_id,
        referenceType: reference_type,
        mediaType: finalMediaType,
        url,
        filename: file.filename,
        mimetype: file.mimetype,
        created_by: req.user.id,
        isPublic
      });
      
      res.status(201).json({ 
        success: true, 
        id: media.id,
        url: media.url,
        filename: media.filename,
        referenceId: media.referenceId,
        referenceType: media.referenceType,
        mediaType: media.mediaType
      });
    } catch (err) {
      // If there was a file uploaded but an error occurred during processing
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      logger.error('Media upload processing error:', err.message);
      res.status(500).json({ error: 'Failed to process the upload' });
    }
  });
});

// Get media for reference with proper authorization
app.get('/api/media/:referenceType/:referenceId', authenticateJWT, async (req, res) => {
  try {
    const { referenceType, referenceId } = req.params;
    
    // Validate reference type
    const validReferenceTypes = ['venue', 'user', 'vendor', 'booking'];
    if (!validReferenceTypes.includes(referenceType)) {
      return errorResponse(res, 400, 'Invalid reference type');
    }
    
    // Validate referenceId format
    if (!referenceId || isNaN(parseInt(referenceId))) {
      return errorResponse(res, 400, 'Invalid reference ID');
    }
    
    let whereClause = { referenceType, referenceId };
    
    // For non-admin users, apply appropriate authorization filters
    if (req.user.role !== 'admin') {
      if (referenceType === 'venue') {
        // Venue media is public or restricted to the venue owner (vendor) 
        // No filter needed if public - will be filtered by isPublic=true later if not the owner
        if (req.user.role === 'vendor') {
          // TODO: In a full implementation, check if this vendor owns this venue
          // For now, trust the role but apply created_by filter as a fallback
          // whereClause.created_by = req.user.id; // Uncomment after ownership verification is implemented
        }
      } else if (referenceType === 'booking') {
        // Only the booking owner should see booking media
        // TODO: In a full implementation, check if user owns this booking
        // For now, filter by created_by
        whereClause.created_by = req.user.id;
      } else if (referenceType === 'user' || referenceType === 'profile') {
        // Users can only see their own profile media
        if (referenceId !== req.user.id.toString()) {
          whereClause.isPublic = true; // Only show public media of other users
        }
      }
      
      // For regular users, only return public media unless they own it
      if (req.user.role === 'user') {
        whereClause = {
          [Sequelize.Op.or]: [
            { ...whereClause, isPublic: true },
            { ...whereClause, created_by: req.user.id }
          ]
        };
      }
    }
    
    const media = await Media.findAll({ 
      where: whereClause,
      attributes: ['id', 'referenceId', 'referenceType', 'mediaType', 'url', 'filename', 'createdAt', 'created_by', 'isPublic']
    });
    
    res.json({ success: true, media });
  } catch (err) {
    logger.error('Get media error:', err.message);
    return errorResponse(res, 500, 'Failed to retrieve media files');
  }
});

// Get media by ID with authentication
app.get('/api/media/:id', authenticateJWT, async (req, res) => {
  try {
    const mediaId = req.params.id;
    
    const media = await Media.findByPk(mediaId);
    
    if (!media) {
      return errorResponse(res, 404, 'Media not found');
    }
    
    // Check authorization - allow access if: admin, media owner, or public media
    if (req.user.role !== 'admin' && 
        media.created_by !== req.user.id && 
        !media.isPublic) {
      
      // For venue media, check if user is the vendor who owns the venue
      if (media.referenceType === 'venue' && req.user.role === 'vendor') {
        // TODO: Check if user owns this venue through Venue Service
        // For now, we're being restrictive
      }
      // For booking media, check if user is involved in the booking
      else if (media.referenceType === 'booking') {
        // TODO: Check if user owns this booking through Booking Service
        // For now, we're being restrictive
      }
      else {
        logger.warn(`User ${req.user.id} attempted to access restricted media ${mediaId}`);
        return errorResponse(res, 403, 'You do not have permission to access this media');
      }
    }
    
    res.json({ success: true, media });
  } catch (err) {
    logger.error(`Get media ${req.params.id} error:`, err.message);
    return errorResponse(res, 500, 'Failed to retrieve media');
  }
});

// Delete media with authentication
app.delete('/api/media/:id', authenticateJWT, async (req, res) => {
  try {
    const mediaId = req.params.id;
    
    const media = await Media.findByPk(mediaId);
    
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }
    
    // Check if user has permission to delete the media
    // Admin can delete any media
    // Users can delete their own media
    // Vendors can delete media for their venues
    let canDelete = false;
    
    if (req.user.role === 'admin') {
      canDelete = true;
    } 
    else if (media.created_by === req.user.id) {
      canDelete = true;
    }
    else if (req.user.role === 'vendor' && media.referenceType === 'venue') {
      // TODO: Check if this vendor owns the venue via Venue Service
      // For now we'll be restrictive
      canDelete = false;
    }
    
    if (!canDelete) {
      logger.warn(`User ${req.user.id} attempted to delete media ${mediaId} without permission`);
      return errorResponse(res, 403, 'You do not have permission to delete this media');
    }
    
    // Delete the file from disk
    try {
      fs.unlinkSync(path.join(uploadDir, media.filename));
      logger.info(`File ${media.filename} deleted from disk by user ${req.user.id}`);
    } catch (err) {
      logger.error(`Failed to delete file from disk: ${media.filename}`, err);
      // Continue deleting the record even if file deletion fails
    }
    
    // Delete the record
    await media.destroy();
    
    res.json({ success: true, message: 'Media deleted successfully' });
  } catch (err) {
    logger.error(`Delete media ${req.params.id} error:`, err.message);
    return errorResponse(res, 500, 'Failed to delete media');
  }
});

// Secure file serving endpoint replacing direct static file access
app.get('/api/media/files/:filename', authenticateJWT, async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Prevent path traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(uploadDir, sanitizedFilename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return errorResponse(res, 404, 'File not found');
    }
    
    // Look up the media in the database
    const media = await Media.findOne({ where: { filename: sanitizedFilename } });
    if (!media) {
      return errorResponse(res, 404, 'Media record not found');
    }
    
    // Check authorization - allow if: admin, media owner, or public media
    const isAuthorized = (
      req.user.role === 'admin' || 
      media.created_by === req.user.id || 
      media.isPublic
    );
    
    // For venue media, check if user is the vendor who owns the venue
    if (!isAuthorized && media.referenceType === 'venue' && req.user.role === 'vendor') {
      // TODO: Check if user owns this venue - for now we're restrictive
    }
    
    // For booking media, check if user is involved in the booking
    if (!isAuthorized && media.referenceType === 'booking') {
      // TODO: Check if user owns this booking - for now we're restrictive
    }
    
    if (!isAuthorized) {
      logger.warn(`User ${req.user.id} attempted to access restricted file ${sanitizedFilename}`);
      return errorResponse(res, 403, 'You do not have permission to access this file');
    }
    
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('Content-Type', media.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${sanitizedFilename}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Handle errors in streaming
    fileStream.on('error', (err) => {
      logger.error(`Error streaming file ${sanitizedFilename}:`, err);
      if (!res.headersSent) {
        return errorResponse(res, 500, 'Error streaming file');
      }
    });
  } catch (err) {
    logger.error(`File access error for ${req.params.filename}:`, err);
    return errorResponse(res, 500, 'Error accessing file');
  }
});

// Redirect any direct /uploads/* access to the secure endpoint
app.use('/uploads/:filename', (req, res) => {
  return errorResponse(res, 403, 'Direct file access is not allowed. Use the secure API endpoint instead.');
});

// Sync DB and start server
sequelize.sync().then(() => {
  app.listen(PORT, () => {
    logger.info(`Media Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});