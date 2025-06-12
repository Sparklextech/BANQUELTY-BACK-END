// Import required modules
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

// Initialize Sequelize
let dbConfig = {
  database: process.env.POSTGRES_DB || 'postgres',
  username: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  host: process.env.POSTGRES_HOST || 'postgres',  // Default to Docker container name
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  dialect: 'postgres',
  logging: false
};

// For Docker environment, we want to use the container name as host
if (process.env.NODE_ENV === 'production' || process.env.POSTGRES_HOST === 'postgres') {
  console.log('Using Docker configuration for database connection');
  dbConfig.host = 'postgres'; // Force the Docker container name in Docker environment
}

console.log(`Connecting to PostgreSQL at ${dbConfig.host}:${dbConfig.port}`);

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    dialectOptions: {
      connectTimeout: 30000 // 30 seconds
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// Import model definition files
const chatModels = require('./models/chat')(sequelize);
const quoteModels = require('./models/quotes')(sequelize);

// Define ServiceProviderCategory model (hierarchical)
const ServiceProviderCategory = sequelize.define('ServiceProviderCategory', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  parentId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ServiceProviderCategories',
      key: 'id'
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

// Self-reference for hierarchical structure
ServiceProviderCategory.belongsTo(ServiceProviderCategory, {
  foreignKey: 'parentId',
  as: 'parent'
});
ServiceProviderCategory.hasMany(ServiceProviderCategory, {
  foreignKey: 'parentId',
  as: 'children'
});

// Define ServiceProviderProfile model
const ServiceProviderProfile = sequelize.define('ServiceProviderProfile', {
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  primaryServiceCategoryId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ServiceProviderCategories',
      key: 'id'
    }
  },
  businessName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  contactEmail: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  websiteUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  addressLine1: {
    type: DataTypes.STRING,
    allowNull: true
  },
  city: {
    type: DataTypes.STRING,
    allowNull: true
  },
  state: {
    type: DataTypes.STRING,
    allowNull: true
  },
  zipCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  yearsOfExperience: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  pricingModel: {
    type: DataTypes.ENUM('price_on_request', 'starts_from'),
    allowNull: true
  },
  basePrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  priceDescription: {
    type: DataTypes.STRING,
    allowNull: true
  },
  socialMediaLinks: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  kycStatus: {
    type: DataTypes.ENUM('pending', 'submitted', 'approved', 'rejected'),
    defaultValue: 'pending'
  },
  kycDocuments: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  // Bank information - consider encryption or moving to a separate secure table
  bankName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  accountHolderName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  accountNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  transitNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  institutionNumber: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

// Define PricingPlan model
const PricingPlan = sequelize.define('PricingPlan', {
  serviceProviderProfileId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ServiceProviderProfiles',
      key: 'id'
    }
  },
  planName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  pricingType: {
    type: DataTypes.ENUM('fixed', 'price_on_request', 'starts_from'),
    allowNull: false
  },
  features: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
});

// Define PortfolioItem model
const PortfolioItem = sequelize.define('PortfolioItem', {
  profileId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ServiceProviderProfiles',
      key: 'id'
    }
  },
  mediaType: {
    type: DataTypes.ENUM('image', 'video'),
    allowNull: false
  },
  mediaUrl: {
    type: DataTypes.STRING,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
});

// Define ServiceProviderProfile_ServiceSubcategories join table
const ServiceProviderProfile_ServiceSubcategory = sequelize.define('ServiceProviderProfile_ServiceSubcategory', {
  // This is a join table with just foreign keys
}, { timestamps: false });

// Define associations
ServiceProviderProfile.belongsTo(ServiceProviderCategory, {
  foreignKey: 'primaryServiceCategoryId',
  as: 'primaryCategory'
});

ServiceProviderProfile.belongsToMany(ServiceProviderCategory, {
  through: ServiceProviderProfile_ServiceSubcategory,
  foreignKey: 'profileId',
  otherKey: 'categoryId',
  as: 'subcategories'
});

ServiceProviderCategory.belongsToMany(ServiceProviderProfile, {
  through: ServiceProviderProfile_ServiceSubcategory,
  foreignKey: 'categoryId',
  otherKey: 'profileId',
  as: 'serviceProviders'
});

ServiceProviderProfile.hasMany(PricingPlan, {
  foreignKey: 'serviceProviderProfileId',
  as: 'pricingPlans'
});

PricingPlan.belongsTo(ServiceProviderProfile, {
  foreignKey: 'serviceProviderProfileId',
  as: 'serviceProviderProfile'
});

ServiceProviderProfile.hasMany(PortfolioItem, {
  foreignKey: 'profileId',
  as: 'portfolioItems'
});

PortfolioItem.belongsTo(ServiceProviderProfile, {
  foreignKey: 'profileId',
  as: 'serviceProviderProfile'
});

// Export models and sequelize instance
module.exports = {
  sequelize,
  ServiceProviderCategory,
  ServiceProviderProfile,
  PricingPlan,
  PortfolioItem,
  ServiceProviderProfile_ServiceSubcategory,
  ChatRoom: chatModels.ChatRoom,
  ChatMessage: chatModels.ChatMessage,
  QuoteRequest: quoteModels.QuoteRequest,
  Quote: quoteModels.Quote,
  QuoteItem: quoteModels.QuoteItem,
  Invoice: quoteModels.Invoice,
  InvoiceItem: quoteModels.InvoiceItem,
  ServiceOrder: quoteModels.ServiceOrder
};
