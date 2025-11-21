module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'services/**/*.js',
    'utils/**/*.js',
    'routes/**/*.js'
  ],
  testMatch: ['**/__tests__/**/*.test.js'],
  verbose: true
};
