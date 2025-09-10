const BOOKING_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
};

const EVENT_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED'
};

const USER_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN'
};

const MESSAGES = {
  SUCCESS: {
    USER_REGISTERED: 'User registered successfully',
    LOGIN_SUCCESS: 'Login successful',
    BOOKING_CREATED: 'Booking created successfully',
    BOOKING_CONFIRMED: 'Booking confirmed successfully',
    BOOKING_CANCELLED: 'Booking cancelled successfully',
    EVENT_CREATED: 'Event created successfully',
    EVENT_UPDATED: 'Event updated successfully'
  },
  ERROR: {
    INVALID_CREDENTIALS: 'Invalid email or password',
    EMAIL_EXISTS: 'Email already exists',
    EVENT_NOT_FOUND: 'Event not found',
    BOOKING_NOT_FOUND: 'Booking not found',
    INSUFFICIENT_SEATS: 'Insufficient seats available',
    EVENT_NOT_BOOKABLE: 'Event is not available for booking'
  }
};

module.exports = {
  BOOKING_STATUS,
  EVENT_STATUS,
  USER_ROLES,
  MESSAGES
};
