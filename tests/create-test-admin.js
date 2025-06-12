/**
 * Create test admin account
 * Creates a predefined admin user for testing purposes
 */
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

async function createTestAdmin() {
  console.log('Connecting to database...');
  
  // Connect to database
  const sequelize = new Sequelize(
    process.env.POSTGRES_DB || 'banquet_db',
    process.env.POSTGRES_USER || 'postgres',
    process.env.POSTGRES_PASSWORD || 'postgres',
    {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || 5433, // Use updated port
      dialect: 'postgres',
      logging: console.log
    }
  );
  
  // Test connection
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
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
  
  // Create test admin
  try {
    console.log('Creating test admin account...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    // Check if admin exists first
    const existingAdmin = await User.findOne({ where: { email: 'admin@example.com' } });
    
    if (existingAdmin) {
      console.log('Admin user already exists. Updating password...');
      await existingAdmin.update({ password: hashedPassword });
      console.log('Admin password updated successfully.');
    } else {
      // Create new admin
      await User.create({
        name: 'Admin User',
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'admin',
        kycStatus: 'approved'
      });
      console.log('Admin user created successfully.');
    }
    
    console.log('Test admin credentials:');
    console.log('- Email: admin@example.com');
    console.log('- Password: admin123');
    
  } catch (error) {
    console.error('Error creating admin user:', error);
  }
  
  // Close connection
  await sequelize.close();
  console.log('Database connection closed.');
}

// Run the function
createTestAdmin().catch(console.error);
