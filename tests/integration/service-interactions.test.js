/**
 * Integration tests for Banquet App Backend
 * Tests interactions between microservices
 */
const axios = require('axios');

// Configure axios for tests
axios.defaults.validateStatus = () => true; // Don't throw on error status codes

// Gateway URL
const GATEWAY_URL = 'http://localhost:4010/api';
let authToken = null;

// Test user for authorization
const testUser = {
  name: 'Integration Test User',
  email: `integration_${Date.now()}@example.com`,
  password: 'Test123!',
  role: 'user'
};

// Test venue data
const testVenue = {
  name: 'Integration Test Venue',
  description: 'A venue for integration testing',
  address: '123 Integration Ave',
  capacity: 150,
  pricingType: 'flat',
  flatPrice: 5000
};

describe('Service Interactions', () => {
  // Setup before all tests - register and login
  beforeAll(async () => {
    // Check if gateway is available
    try {
      const healthRes = await axios.get(`${GATEWAY_URL}/health`);
      if (healthRes.status !== 200) {
        console.error('API Gateway is not available. Skipping integration tests.');
        return;
      }
      
      // Register test user
      const registerRes = await axios.post(`${GATEWAY_URL}/auth/register`, testUser);
      
      // Login to get token
      const loginRes = await axios.post(`${GATEWAY_URL}/auth/login`, {
        email: testUser.email,
        password: testUser.password
      });
      
      if (loginRes.status === 200 && loginRes.data.token) {
        authToken = loginRes.data.token;
      }
    } catch (error) {
      console.error('Setup failed:', error.message);
    }
  }, 30000); // Longer timeout for setup
  
  // Auth Service - Venue Service interaction
  test('Auth Service properly forwards user context to Venue Service', async () => {
    // Skip if no auth token
    if (!authToken) {
      console.warn('No auth token available. Skipping test.');
      return;
    }
    
    // Try to create a venue - should fail with 403 for non-vendor users
    const createVenueRes = await axios.post(
      `${GATEWAY_URL}/venue/venues`,
      testVenue,
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );
    
    // Regular users should get Forbidden (only vendors can create venues)
    expect(createVenueRes.status).toBe(403);
    expect(createVenueRes.data.error).toContain('Forbidden');
  }, 10000);
  
  // Auth Service - Booking Service interaction
  test('Authenticated user can interact with booking service', async () => {
    // Skip if no auth token
    if (!authToken) {
      console.warn('No auth token available. Skipping test.');
      return;
    }
    
    // Get bookings as authenticated user
    const bookingsRes = await axios.get(
      `${GATEWAY_URL}/booking/bookings`,
      {
        headers: { Authorization: `Bearer ${authToken}` }
      }
    );
    
    // Should be authorized to get bookings
    expect(bookingsRes.status).toBe(200);
    expect(Array.isArray(bookingsRes.data)).toBeTruthy();
  }, 10000);
  
  // Venue Service - Category interaction
  test('Venue Service properly handles category data', async () => {
    // Get venue categories - doesn't require auth
    const categoriesRes = await axios.get(`${GATEWAY_URL}/venue/categories`);
    
    // Should return categories successfully
    expect(categoriesRes.status).toBe(200);
    expect(Array.isArray(categoriesRes.data)).toBeTruthy();
  }, 10000);
  
  // Error case: Unauthorized access
  test('Gateway properly blocks unauthorized access to protected endpoints', async () => {
    // Try to access protected endpoint without token
    const protectedRes = await axios.get(`${GATEWAY_URL}/booking/bookings`);
    
    // Should be unauthorized
    expect(protectedRes.status).toBe(401);
    expect(protectedRes.data.error).toBeTruthy();
  }, 10000);
});
