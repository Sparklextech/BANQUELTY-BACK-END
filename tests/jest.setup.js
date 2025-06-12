/**
 * Jest setup file for Banquet App Backend tests
 */

// Increase timeouts for all tests to handle network operations
jest.setTimeout(30000);

// Suppress specific console messages during tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Optionally filter console output during tests
if (process.env.SUPPRESS_CONSOLE) {
  console.log = (...args) => {
    // Only show important logs during tests
    if (args[0] && typeof args[0] === 'string' && 
        (args[0].includes('ERROR') || args[0].includes('FATAL'))) {
      originalConsoleLog(...args);
    }
  };
  
  console.warn = (...args) => {
    // Only show important warnings
    if (args[0] && typeof args[0] === 'string' && 
        (args[0].includes('ERROR') || args[0].includes('FATAL'))) {
      originalConsoleWarn(...args);
    }
  };
  
  console.error = (...args) => {
    // Always show errors
    originalConsoleError(...args);
  };
}

// Global setup - runs before all tests
beforeAll(() => {
  console.log('Starting Banquet App Backend tests...');
});

// Global teardown - runs after all tests
afterAll(() => {
  // Restore console
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  
  console.log('Finished running all tests!');
});
