/**
 * Jest configuration for Banquet App Backend tests
 */
module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,

  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // The test environment that will be used for testing
  testEnvironment: "node",

  // The glob patterns Jest uses to detect test files
  testMatch: [
    "**/__tests__/**/*.js",
    "**/?(*.)+(spec|test).js"
  ],

  // An array of regexp pattern strings that are matched against all test paths
  testPathIgnorePatterns: [
    "/node_modules/"
  ],

  // The maximum amount of workers used to run your tests
  maxWorkers: "50%",

  // A list of paths to directories that Jest should use to search for files in
  roots: [
    "<rootDir>/tests/"
  ],

  // Indicates whether each individual test should be reported during the run
  verbose: true,

  // Setting a timeout for tests (30 seconds)
  testTimeout: 30000,
  
  // Configure setup files
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
};
