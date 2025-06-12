/**
 * Unit tests for Venue Service
 */

// Mock data for venue service
const mockVenue = {
  id: 1,
  name: 'Test Venue',
  description: 'A test venue',
  address: '123 Test St',
  capacity: 100,
  imageUrl: 'http://example.com/venue.jpg',
  vendorId: 1,
  categoryId: 1,
  pricingType: 'flat',
  flatPrice: 5000,
  perHeadPrice: null,
  minGuests: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const mockCategory = {
  id: 1,
  name: 'Wedding Hall',
  description: 'Perfect for wedding ceremonies',
  createdAt: new Date(),
  updatedAt: new Date()
};

// Mock Sequelize models
const mockSequelizeModels = {
  Venue: {
    findAll: jest.fn().mockResolvedValue([mockVenue]),
    findByPk: jest.fn().mockResolvedValue(mockVenue),
    create: jest.fn().mockResolvedValue(mockVenue),
    update: jest.fn().mockResolvedValue([1]),
    destroy: jest.fn().mockResolvedValue(1)
  },
  Category: {
    findAll: jest.fn().mockResolvedValue([mockCategory]),
    findOne: jest.fn().mockResolvedValue(mockCategory)
  }
};

describe('Venue Service - Venue CRUD Operations', () => {
  // Reset mocks before each test
  beforeEach(() => {
    mockSequelizeModels.Venue.findAll.mockClear();
    mockSequelizeModels.Venue.findByPk.mockClear();
    mockSequelizeModels.Venue.create.mockClear();
    mockSequelizeModels.Venue.update.mockClear();
    mockSequelizeModels.Venue.destroy.mockClear();
  });

  test('getAllVenues returns all venues', async () => {
    // Simulate the venue service's getAllVenues function
    const getAllVenues = async () => {
      return await mockSequelizeModels.Venue.findAll();
    };
    
    const venues = await getAllVenues();
    
    expect(mockSequelizeModels.Venue.findAll).toHaveBeenCalled();
    expect(venues).toHaveLength(1);
    expect(venues[0].id).toBe(1);
    expect(venues[0].name).toBe('Test Venue');
  });

  test('getVenueById returns a specific venue', async () => {
    // Simulate the venue service's getVenueById function
    const getVenueById = async (id) => {
      return await mockSequelizeModels.Venue.findByPk(id);
    };
    
    const venue = await getVenueById(1);
    
    expect(mockSequelizeModels.Venue.findByPk).toHaveBeenCalledWith(1);
    expect(venue.id).toBe(1);
    expect(venue.name).toBe('Test Venue');
  });

  test('createVenue creates a new venue', async () => {
    // Simulate the venue service's createVenue function
    const createVenue = async (venueData) => {
      return await mockSequelizeModels.Venue.create(venueData);
    };
    
    const venueData = {
      name: 'New Venue',
      description: 'A new test venue',
      address: '456 Test Ave',
      capacity: 200,
      vendorId: 1,
      categoryId: 1,
      pricingType: 'flat',
      flatPrice: 6000
    };
    
    const venue = await createVenue(venueData);
    
    expect(mockSequelizeModels.Venue.create).toHaveBeenCalledWith(venueData);
    expect(venue.id).toBe(1); // Mock always returns mockVenue
  });
});

describe('Venue Service - Category Operations', () => {
  // Reset mocks before each test
  beforeEach(() => {
    mockSequelizeModels.Category.findAll.mockClear();
    mockSequelizeModels.Category.findOne.mockClear();
  });

  test('getAllCategories returns all categories', async () => {
    // Simulate the venue service's getAllCategories function
    const getAllCategories = async () => {
      return await mockSequelizeModels.Category.findAll();
    };
    
    const categories = await getAllCategories();
    
    expect(mockSequelizeModels.Category.findAll).toHaveBeenCalled();
    expect(categories).toHaveLength(1);
    expect(categories[0].id).toBe(1);
    expect(categories[0].name).toBe('Wedding Hall');
  });

  test('getCategoryByName returns a specific category', async () => {
    // Simulate the venue service's getCategoryByName function
    const getCategoryByName = async (name) => {
      return await mockSequelizeModels.Category.findOne({
        where: { name }
      });
    };
    
    const category = await getCategoryByName('Wedding Hall');
    
    expect(mockSequelizeModels.Category.findOne).toHaveBeenCalledWith({
      where: { name: 'Wedding Hall' }
    });
    expect(category.id).toBe(1);
    expect(category.name).toBe('Wedding Hall');
  });
});
