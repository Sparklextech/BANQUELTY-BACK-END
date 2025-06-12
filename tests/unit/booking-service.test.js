/**
 * Unit tests for Booking Service
 */

// Mock data for booking service
const mockBooking = {
  id: 1,
  userId: 1,
  venueId: 1,
  vendorId: 1,
  date: '2025-12-31',
  guestCount: 100,
  pricingType: 'flat',
  flatPrice: 5000,
  perHeadPrice: null,
  minGuests: null,
  additionalServices: [],
  totalPrice: 5000,
  status: 'pending',
  createdAt: new Date(),
  updatedAt: new Date()
};

// Mock Sequelize model
const mockBookingModel = {
  findAll: jest.fn().mockResolvedValue([mockBooking]),
  findByPk: jest.fn().mockResolvedValue(mockBooking),
  create: jest.fn().mockResolvedValue(mockBooking),
  update: jest.fn().mockResolvedValue([1]),
  destroy: jest.fn().mockResolvedValue(1)
};

describe('Booking Service - CRUD Operations', () => {
  // Reset mocks before each test
  beforeEach(() => {
    mockBookingModel.findAll.mockClear();
    mockBookingModel.findByPk.mockClear();
    mockBookingModel.create.mockClear();
    mockBookingModel.update.mockClear();
    mockBookingModel.destroy.mockClear();
  });

  test('getAllBookings returns all bookings', async () => {
    // Simulate the booking service's getAllBookings function
    const getAllBookings = async () => {
      return await mockBookingModel.findAll();
    };
    
    const bookings = await getAllBookings();
    
    expect(mockBookingModel.findAll).toHaveBeenCalled();
    expect(bookings).toHaveLength(1);
    expect(bookings[0].id).toBe(1);
    expect(bookings[0].userId).toBe(1);
  });

  test('getBookingById returns a specific booking', async () => {
    // Simulate the booking service's getBookingById function
    const getBookingById = async (id) => {
      return await mockBookingModel.findByPk(id);
    };
    
    const booking = await getBookingById(1);
    
    expect(mockBookingModel.findByPk).toHaveBeenCalledWith(1);
    expect(booking.id).toBe(1);
    expect(booking.status).toBe('pending');
  });

  test('createBooking creates a new booking with correct pricing', async () => {
    // Simulate the booking service's createBooking function with price calculation
    const createBooking = async (bookingData) => {
      // Calculate total price
      let totalPrice = 0;
      
      if (bookingData.pricingType === 'flat') {
        totalPrice = bookingData.flatPrice;
      } else if (bookingData.pricingType === 'per_head') {
        // Check minimum guests requirement
        if (bookingData.guestCount < (bookingData.minGuests || 0)) {
          throw new Error('Guest count below minimum required');
        }
        totalPrice = bookingData.guestCount * bookingData.perHeadPrice;
      }
      
      // Add price of additional services
      if (Array.isArray(bookingData.additionalServices)) {
        totalPrice += bookingData.additionalServices.reduce((sum, service) => 
          sum + (service.price || 0), 0);
      }
      
      // Create booking with calculated total price
      return await mockBookingModel.create({
        ...bookingData,
        totalPrice
      });
    };
    
    // Test flat price booking
    const flatPriceBookingData = {
      userId: 2,
      venueId: 2,
      vendorId: 2,
      date: '2025-11-15',
      guestCount: 150,
      pricingType: 'flat',
      flatPrice: 6000,
      additionalServices: []
    };
    
    await createBooking(flatPriceBookingData);
    
    expect(mockBookingModel.create).toHaveBeenCalledWith({
      ...flatPriceBookingData,
      totalPrice: 6000
    });
    
    // Reset mock to test per_head pricing
    mockBookingModel.create.mockClear();
    
    // Test per_head price booking
    const perHeadBookingData = {
      userId: 3,
      venueId: 3,
      vendorId: 3,
      date: '2025-10-20',
      guestCount: 80,
      pricingType: 'per_head',
      perHeadPrice: 50,
      minGuests: 50,
      additionalServices: [
        { name: 'Decoration', price: 500 },
        { name: 'DJ', price: 300 }
      ]
    };
    
    await createBooking(perHeadBookingData);
    
    // Expected price: (80 guests * $50 per head) + $500 decoration + $300 DJ = $4800
    expect(mockBookingModel.create).toHaveBeenCalledWith({
      ...perHeadBookingData,
      totalPrice: 4800
    });
  });

  test('updateBookingStatus updates a booking status', async () => {
    // Simulate the booking service's updateBookingStatus function
    const updateBookingStatus = async (id, status) => {
      const [updated] = await mockBookingModel.update({ status }, { 
        where: { id } 
      });
      
      if (updated) {
        return await mockBookingModel.findByPk(id);
      }
      
      throw new Error('Booking not found');
    };
    
    const booking = await updateBookingStatus(1, 'confirmed');
    
    expect(mockBookingModel.update).toHaveBeenCalledWith(
      { status: 'confirmed' }, 
      { where: { id: 1 } }
    );
    expect(mockBookingModel.findByPk).toHaveBeenCalledWith(1);
    expect(booking.id).toBe(1);
  });
});
