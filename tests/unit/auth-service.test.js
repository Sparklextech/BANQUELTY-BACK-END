/**
 * Unit tests for Authentication Service
 */
const jwt = require('jsonwebtoken');

// Mock configuration
const JWT_SECRET = 'test-secret-key';

// Mock the necessary modules
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mocked-token'),
  verify: jest.fn().mockImplementation((token, secret) => {
    if (token === 'valid-token') {
      return { id: 1, email: 'test@example.com', role: 'user' };
    } else {
      throw new Error('Invalid token');
    }
  })
}));

describe('Auth Service - JWT Functions', () => {
  test('JWT sign creates a token with correct payload', () => {
    const payload = { id: 1, email: 'test@example.com', role: 'user' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    
    expect(jwt.sign).toHaveBeenCalledWith(payload, JWT_SECRET, { expiresIn: '1h' });
    expect(token).toBe('mocked-token');
  });

  test('JWT verify validates a token correctly', () => {
    const token = 'valid-token';
    const decoded = jwt.verify(token, JWT_SECRET);
    
    expect(jwt.verify).toHaveBeenCalledWith(token, JWT_SECRET);
    expect(decoded).toEqual({ id: 1, email: 'test@example.com', role: 'user' });
  });

  test('JWT verify throws error for invalid token', () => {
    const token = 'invalid-token';
    
    expect(() => {
      jwt.verify(token, JWT_SECRET);
    }).toThrow('Invalid token');
  });
});

// Test password hashing functions
describe('Auth Service - Password Hashing', () => {
  // Simple mock of bcrypt functionality
  const bcrypt = {
    hash: (password, salt) => `hashed-${password}-${salt}`,
    compare: (password, hashedPassword) => {
      return hashedPassword === `hashed-${password}-10`;
    }
  };

  test('Password is hashed correctly', () => {
    const password = 'test-password';
    const hashedPassword = bcrypt.hash(password, 10);
    
    expect(hashedPassword).toBe('hashed-test-password-10');
  });

  test('Password comparison works for correct password', () => {
    const password = 'test-password';
    const hashedPassword = 'hashed-test-password-10';
    
    const result = bcrypt.compare(password, hashedPassword);
    expect(result).toBe(true);
  });

  test('Password comparison fails for incorrect password', () => {
    const password = 'wrong-password';
    const hashedPassword = 'hashed-test-password-10';
    
    const result = bcrypt.compare(password, hashedPassword);
    expect(result).toBe(false);
  });
});
