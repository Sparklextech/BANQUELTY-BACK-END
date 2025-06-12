/**
 * Authentication Fix Script
 * To be run inside the auth-service container
 */
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

async function fixAuth() {
  console.log('🔧 Starting authentication fix...');
  
  // Connect to database
  const sequelize = new Sequelize(
    process.env.POSTGRES_DB || 'banquet_db',
    process.env.POSTGRES_USER || 'postgres',
    process.env.POSTGRES_PASSWORD || 'postgres',
    {
      host: process.env.POSTGRES_HOST || 'postgres',
      port: process.env.POSTGRES_PORT || 5432,
      dialect: 'postgres',
      logging: console.log
    }
  );
  
  // Test connection
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established.');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
  
  // Define User model
  const User = sequelize.define('User', {
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'user' },
    kycStatus: { type: DataTypes.STRING, defaultValue: 'pending' }
  }, { tableName: 'Users' });
  
  try {
    // Create test accounts with known credentials
    console.log('🔧 Creating test accounts...');
    
    // Create test admin
    const adminPassword = await bcrypt.hash('admin123', 10);
    const [admin, adminCreated] = await User.findOrCreate({
      where: { email: 'admin@example.com' },
      defaults: {
        name: 'Test Admin',
        password: adminPassword,
        role: 'admin',
        kycStatus: 'approved'
      }
    });
    
    if (!adminCreated) {
      admin.password = adminPassword;
      await admin.save();
      console.log('✅ Admin user updated');
    } else {
      console.log('✅ Admin user created');
    }
    
    // Create test vendor
    const vendorPassword = await bcrypt.hash('vendor123', 10);
    const [vendor, vendorCreated] = await User.findOrCreate({
      where: { email: 'vendor@example.com' },
      defaults: {
        name: 'Test Vendor',
        password: vendorPassword,
        role: 'vendor',
        kycStatus: 'approved'
      }
    });
    
    if (!vendorCreated) {
      vendor.password = vendorPassword;
      await vendor.save();
      console.log('✅ Vendor user updated');
    } else {
      console.log('✅ Vendor user created');
    }
    
    // Create test customer
    const customerPassword = await bcrypt.hash('customer123', 10);
    const [customer, customerCreated] = await User.findOrCreate({
      where: { email: 'customer@example.com' },
      defaults: {
        name: 'Test Customer',
        password: customerPassword,
        role: 'user'
      }
    });
    
    if (!customerCreated) {
      customer.password = customerPassword;
      await customer.save();
      console.log('✅ Customer user updated');
    } else {
      console.log('✅ Customer user created');
    }
    
    console.log('\n🔑 TEST CREDENTIALS:');
    console.log('----------------------');
    console.log('Admin:');
    console.log('  Email: admin@example.com');
    console.log('  Password: admin123');
    console.log('  Role: admin');
    console.log('\nVendor:');
    console.log('  Email: vendor@example.com');
    console.log('  Password: vendor123');
    console.log('  Role: vendor');
    console.log('\nCustomer:');
    console.log('  Email: customer@example.com');
    console.log('  Password: customer123');
    console.log('  Role: user');
    console.log('----------------------');
    
  } catch (error) {
    console.error('❌ Error fixing authentication:', error);
  }
  
  // Close connection
  await sequelize.close();
  console.log('✅ Database connection closed.');
  console.log('🎉 Authentication fix complete!');
}

// Run the function
fixAuth().catch(console.error);
