require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const PORT = process.env.ADMIN_SERVICE_PORT || 4004; // Changed from 4001 to 4004 to avoid conflict with auth service

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

// Admin models
const Admin = sequelize.define('Admin', {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false }
});
const Vendor = sequelize.define('Vendor', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  kycStatus: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' }
});
const User = sequelize.define('User', {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'user' },
  kycStatus: { type: DataTypes.STRING, defaultValue: 'pending' }
});

// Service API clients
const authService = axios.create({
  baseURL: process.env.AUTH_SERVICE_URL || 'http://auth-service:4001',
  timeout: 5000
});

const vendorService = axios.create({
  baseURL: process.env.VENDOR_SERVICE_URL || 'http://vendor-service:4003',
  timeout: 5000
});

const bookingService = axios.create({
  baseURL: process.env.BOOKING_SERVICE_URL || 'http://booking-service:4005',
  timeout: 5000
});

// Health check
app.get('/api/admin/health', (req, res) => res.json({ status: 'ok' }));

// REMOVED: Duplicate unauthenticated /api/admin/users endpoint
// Using authenticated endpoint at line ~240 instead

// REMOVED duplicate endpoint /api/auth/users that overlaps with auth service
// Use the proper /api/admin/users endpoint instead for admin functionality

// REMOVED duplicate endpoint /api/vendor/vendors that overlaps with vendor service
// REMOVED duplicate endpoint /api/vendor/vendors that overlaps with vendor service
// Use appropriate endpoints via the vendor service

// Admin JWT authentication middleware
function authenticateJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logger.warn('No authorization header provided');
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Validate token format explicitly
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('Invalid authorization header format - does not start with Bearer');
      return res.status(401).json({ error: 'Invalid authorization header format. Format is: Bearer [token]' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.warn('Empty token in authorization header');
      return res.status(401).json({ error: 'Empty token provided' });
    }
    
    // Ensure JWT_SECRET is set and not using a hardcoded fallback
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET environment variable is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      logger.warn(`Access denied for non-admin user (role: ${decoded.role})`);
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    logger.error('JWT validation error:', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Get dashboard analytics data
app.get('/api/admin/dashboard', authenticateJWT, async (req, res) => {
  try {
    // Get user counts by role
    const totalUsers = await User.count();
    const activeUsers = await User.count({ where: { role: 'user' } });
    const pendingKycUsers = await User.count({ where: { kycStatus: 'pending' } });
    
    // Get vendor counts by kycStatus (which exists)
    const totalVendors = await Vendor.count();
    const approvedVendors = await Vendor.count({ where: { kycStatus: 'approved' } });
    const pendingVendors = await Vendor.count({ where: { kycStatus: 'pending' } });
    
    // Build the stats object with confirmed data
    const stats = {
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingKycUsers
      },
      vendors: {
        total: totalVendors,
        active: approvedVendors,
        pending: pendingVendors
      },
      bookings: {
        total: 0, // Would come from Booking service
        pending: 0,
        confirmed: 0,
        cancelled: 0
      },
      revenue: {
        total: 0, // Would come from Booking service
        thisMonth: 0,
        lastMonth: 0
      }
    };
    
    res.json(stats);
  } catch (error) {
    logger.error(`Dashboard error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update user (admin endpoint)
app.put('/api/admin/users/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, role, kycStatus } = req.body;
    
    // Find the user
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update allowed fields
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (role && ['user', 'vendor', 'admin'].includes(role)) updates.role = role;
    if (kycStatus && ['pending', 'approved', 'rejected'].includes(kycStatus)) updates.kycStatus = kycStatus;
    
    // Apply updates
    await user.update(updates);
    
    // Return updated user
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      kycStatus: user.kycStatus,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  } catch (err) {
    logger.error(`Update user error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin endpoint)
app.delete('/api/admin/users/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Find the user
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete the user
    await user.destroy();
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    logger.error(`Delete user error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List users (admin endpoint)
app.get('/api/admin/users', authenticateJWT, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'kycStatus', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// List vendors (admin endpoint)
app.get('/api/admin/vendors', authenticateJWT, async (req, res) => {
  try {
    const vendors = await Vendor.findAll({
      attributes: ['id', 'name', 'email', 'kycStatus', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']]
    });
    res.json(vendors);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single user by ID
app.get('/api/admin/users/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'role', 'kycStatus', 'createdAt', 'updatedAt']
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get a single vendor by ID
app.get('/api/admin/vendors/:id', authenticateJWT, async (req, res) => {
  try {
    const vendorId = req.params.id;
    const vendor = await Vendor.findByPk(vendorId, {
      attributes: ['id', 'name', 'email', 'kycStatus', 'createdAt', 'updatedAt']
    });
    
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    
    res.json(vendor);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Update user in auth service
async function updateUserInAuthService(userId, updates, token) {
  try {
    await authService.put(`/api/auth/users/${userId}`, updates, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return true;
  } catch (err) {
    logger.error(`Failed to update user in auth service: ${err.message}`);
    return false;
  }
}

// Approve vendor KYC
app.put('/api/admin/vendors/:id/approve', authenticateJWT, async (req, res) => {
  try {
    const vendorId = req.params.id;
    
    // First check if vendor exists - ONLY use fields we are sure exist
    const vendor = await Vendor.findOne({ 
      where: { id: vendorId },
      attributes: ['id', 'name', 'email', 'kycStatus'] // Only select fields we know exist
    });
    
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    
    // ONLY update the kycStatus field - do not reference or update any 'status' field
    await vendor.update({ 
      kycStatus: 'approved' 
    });
    
    // Fetch the updated vendor data
    const updatedVendor = await Vendor.findOne({
      where: { id: vendorId },
      attributes: ['id', 'name', 'email', 'kycStatus'] // Only select fields we know exist
    });
    
    // Try to update in auth service as well - only update kycStatus
    const authServicePayload = { kycStatus: 'approved' }; // ONLY kycStatus
    
    let authUpdated = false;
    try {
      await updateUserInAuthService(
        vendorId, 
        authServicePayload,
        req.headers.authorization.split(' ')[1]
      );
      authUpdated = true;
    } catch (authError) {
      logger.error(`Failed to update auth service: ${authError.message}`);
      authUpdated = false;
    }
    
    return res.json({ 
      success: true, 
      message: 'Vendor KYC approved',
      authServiceUpdated: authUpdated,
      vendor: updatedVendor
    });
  } catch (error) {
    logger.error(`Approve vendor error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Reject vendor KYC
app.put('/api/admin/vendors/:id/reject', authenticateJWT, async (req, res) => {
  try {
    const vendorId = req.params.id;
    
    // First check if vendor exists - ONLY use fields we are sure exist
    const vendor = await Vendor.findOne({ 
      where: { id: vendorId },
      attributes: ['id', 'name', 'email', 'kycStatus'] // Only select fields we know exist
    });
    
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    
    // ONLY update the kycStatus field - do not reference or update any 'status' field
    await vendor.update({ 
      kycStatus: 'rejected' 
    });
    
    // Fetch the updated vendor data
    const updatedVendor = await Vendor.findOne({
      where: { id: vendorId },
      attributes: ['id', 'name', 'email', 'kycStatus'] // Only select fields we know exist
    });
    
    // Try to update in auth service as well - only update kycStatus
    const authServicePayload = { kycStatus: 'rejected' }; // ONLY kycStatus
    
    let authUpdated = false;
    try {
      await updateUserInAuthService(
        vendorId, 
        authServicePayload,
        req.headers.authorization.split(' ')[1]
      );
      authUpdated = true;
    } catch (authError) {
      logger.error(`Failed to update auth service: ${authError.message}`);
      authUpdated = false;
    }
    
    return res.json({ 
      success: true, 
      message: 'Vendor KYC rejected',
      authServiceUpdated: authUpdated,
      vendor: updatedVendor
    });
  } catch (error) {
    logger.error(`Reject vendor error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Get statistics for admin dashboard
app.get('/api/admin/stats', authenticateJWT, async (req, res) => {
  try {
    // Count users by role
    const totalUsers = await User.count();
    const usersByRole = {
      user: await User.count({ where: { role: 'user' } }),
      vendor: await User.count({ where: { role: 'vendor' } }),
      admin: await User.count({ where: { role: 'admin' } })
    };
    
    // Count vendors by KYC status
    const totalVendors = await Vendor.count();
    const vendorsByKycStatus = {
      pending: await Vendor.count({ where: { kycStatus: 'pending' } }),
      approved: await Vendor.count({ where: { kycStatus: 'approved' } }),
      rejected: await Vendor.count({ where: { kycStatus: 'rejected' } })
    };
    
    // Get statistics from other services if available
    let bookingStats = { total: 0, pending: 0, confirmed: 0, cancelled: 0 };
    try {
      const bookingResponse = await bookingService.get('/api/booking/stats', {
        headers: { 'Authorization': req.headers.authorization }
      });
      bookingStats = bookingResponse.data;
    } catch (err) {
      logger.warn('Could not fetch booking stats:', err.message);
    }
    
    res.json({
      users: {
        total: totalUsers,
        byRole: usersByRole
      },
      vendors: {
        total: totalVendors,
        byKycStatus: vendorsByKycStatus
      },
      bookings: bookingStats
    });
  } catch (err) {
    logger.error(`Stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sync DB and start server
sequelize.sync().then(() => {
  app.listen(PORT, () => {
    logger.info(`Admin Service running on port ${PORT}`);
  });
}).catch(err => {
  logger.error('Failed to sync DB:', err);
  process.exit(1);
});