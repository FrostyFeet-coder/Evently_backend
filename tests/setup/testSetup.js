// tests/setup/testSetup.js

require('dotenv').config();

const analyticsService = require('../../src/services/analyticsService');

process.env.NODE_ENV = 'test';
process.env.PORT = '3000';

// Your environment variables (replace with real or test values)
process.env.DB_NAME = 's1';
process.env.DB_USER = 'evently_user';
process.env.DB_PASSWORD = 'your_secure_password';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DATABASE_URL = 'postgres://evently_user:your_secure_password@localhost:5432/s1';

process.env.REDIS_URL = 'redis://localhost:6379';

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '7d';

process.env.BOOKING_EXPIRY_MINUTES = '15';
process.env.CANCELLATION_DEADLINE_HOURS = '24';

process.env.EMAIL_USER = 'your-email@gmail.com';
process.env.EMAIL_APP_PASSWORD = 'your-gmail-app-password';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.WEBSOCKET_ENABLED = 'true';

process.env.SMTP_HOST = 'smtp.gmail.com';
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = 'your gmail';
process.env.SMTP_PASSWORD = 'your password';
process.env.SMTP_FROM = 'noreply@evently.com';

process.env.PAYMENT_GATEWAY_KEY = 'test_key';
process.env.PAYMENT_GATEWAY_SECRET = 'test_secret';

// Optional: mute logs during tests
global.console = {
  ...console,
  // Uncomment to silence logs during tests:
  // log: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Utility for creating mock req/res objects
global.testUtils = {
  createMockReq: (overrides = {}) => ({
    user: { id: 'user-123' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  }),
  createMockRes: () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  }),
};

beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  analyticsService.stopBroadcasting();  // Clean up active intervals after tests
  jest.useRealTimers();
});
