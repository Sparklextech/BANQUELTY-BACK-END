// Quote and Invoice Models for Service Provider Service
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Quote Request Model
  const QuoteRequest = sequelize.define('QuoteRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'The customer/user ID who requested the quote'
    },
    serviceProviderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'The service provider ID'
    },
    serviceDate: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Requested date of service'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Description of the requested service'
    },
    status: {
      type: DataTypes.ENUM('pending', 'quoted', 'accepted', 'rejected', 'expired'),
      defaultValue: 'pending'
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    customerPhone: {
      type: DataTypes.STRING,
      allowNull: true
    }
  });

  // Quote Model (Service Provider's response to a quote request)
  const Quote = sequelize.define('Quote', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    quoteRequestId: {
      type: DataTypes.INTEGER,
      allowNull: true, // Can be null if provider initiates the quote
      comment: 'Reference to the original quote request, if any'
    },
    serviceProviderId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: false
    },
    serviceDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'invoiced'),
      defaultValue: 'draft'
    },
    validUntil: {
      type: DataTypes.DATE,
      allowNull: false
    }
  });

  // Quote Item Model
  const QuoteItem = sequelize.define('QuoteItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    quoteId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    itemName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    }
  });

  // Invoice Model
  const Invoice = sequelize.define('Invoice', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    quoteId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    serviceProviderId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    customerName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    customerEmail: {
      type: DataTypes.STRING,
      allowNull: false
    },
    serviceDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'paid', 'overdue', 'cancelled'),
      defaultValue: 'pending'
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    paymentLink: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Stripe payment link'
    },
    paymentDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    paymentReference: {
      type: DataTypes.STRING,
      allowNull: true
    }
  });

  // Invoice Item Model
  const InvoiceItem = sequelize.define('InvoiceItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    invoiceId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    itemName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    }
  });

  // Service Order Model (created when an invoice is paid)
  const ServiceOrder = sequelize.define('ServiceOrder', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    invoiceId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    serviceProviderId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    serviceDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('confirmed', 'in_progress', 'completed', 'cancelled'),
      defaultValue: 'confirmed'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  });

  // Set up associations
  Quote.hasMany(QuoteItem, { foreignKey: 'quoteId', as: 'items' });
  QuoteItem.belongsTo(Quote, { foreignKey: 'quoteId' });

  QuoteRequest.hasOne(Quote, { foreignKey: 'quoteRequestId' });
  Quote.belongsTo(QuoteRequest, { foreignKey: 'quoteRequestId' });

  Invoice.hasMany(InvoiceItem, { foreignKey: 'invoiceId', as: 'items' });
  InvoiceItem.belongsTo(Invoice, { foreignKey: 'invoiceId' });

  Quote.hasOne(Invoice, { foreignKey: 'quoteId' });
  Invoice.belongsTo(Quote, { foreignKey: 'quoteId' });

  Invoice.hasOne(ServiceOrder, { foreignKey: 'invoiceId' });
  ServiceOrder.belongsTo(Invoice, { foreignKey: 'invoiceId' });

  return {
    QuoteRequest,
    Quote,
    QuoteItem,
    Invoice,
    InvoiceItem,
    ServiceOrder
  };
};
