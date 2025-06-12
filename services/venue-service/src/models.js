const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const Category = sequelize.define('Category', {
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  description: { type: DataTypes.TEXT }
});

const Venue = sequelize.define('Venue', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  address: { type: DataTypes.STRING, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false },
  imageUrl: { type: DataTypes.STRING },
  vendorId: { type: DataTypes.INTEGER, allowNull: false },
  categoryId: { type: DataTypes.INTEGER, allowNull: false },
  pricingType: { type: DataTypes.ENUM('flat', 'per_head'), allowNull: false },
  flatPrice: { type: DataTypes.FLOAT },
  perHeadPrice: { type: DataTypes.FLOAT },
  minGuests: { type: DataTypes.INTEGER }
});

const AdditionalService = sequelize.define('AdditionalService', {
  name: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false },
  venueId: { type: DataTypes.INTEGER, allowNull: false }
});

Category.hasMany(Venue, { foreignKey: 'categoryId' });
Venue.belongsTo(Category, { foreignKey: 'categoryId' });
Venue.hasMany(AdditionalService, { foreignKey: 'venueId' });
AdditionalService.belongsTo(Venue, { foreignKey: 'venueId' });

module.exports = { sequelize, Category, Venue, AdditionalService };
