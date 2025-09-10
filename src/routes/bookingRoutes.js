// src/routes/bookingRoutes.js - ENHANCED WITH SEAT BOOKING INTEGRATION
const express = require('express');
const {
  // Enhanced booking methods
  reserveSeats,
  confirmBooking,
  releaseReservation,
  getSeatMap,
  
  // Existing booking methods (keep these)
  createBooking,
  getBookings,
  getBookingById,
  cancelBooking,
  getUserBookings,
  
  // New methods for enhanced flow
  getBookingStatus,
  extendReservation,
  validateBookingStep
} = require('../controllers/bookingController');

const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

// ========================================
// ENHANCED BOOKING FLOW (BookMyShow Style)
// ========================================

// STEP 0: View seat map for an event (public)
router.get('/events/:eventId/seats', getSeatMap);

// STEP 1: Reserve seats temporarily (15-minute hold)
router.post('/reserve', 
  authenticateToken,
  validate(schemas.reserveSeats),
  reserveSeats
);

// STEP 2: Confirm booking with payment
router.post('/:bookingId/confirm',
  authenticateToken,
  validate(schemas.confirmBooking),
  confirmBooking
);

// STEP 3: Release reservation (manual or auto-expire)
router.delete('/:bookingId/release',
  authenticateToken,
  releaseReservation
);

// ========================================
// BOOKING MANAGEMENT
// ========================================

// Get booking details with real-time status
router.get('/:bookingId',
  authenticateToken,
  getBookingById
);

// Get booking status and time remaining
router.get('/:bookingId/status',
  authenticateToken,
  getBookingStatus
);

// Extend reservation by 5 more minutes (one-time only)
router.post('/:bookingId/extend',
  authenticateToken,
  extendReservation
);

// Cancel booking (with refund calculation)
router.put('/:bookingId/cancel',
  authenticateToken,
  validate(schemas.cancelBooking),
  cancelBooking
);

// ========================================
// USER BOOKINGS
// ========================================

// Get user's booking history
router.get('/',
  authenticateToken,
  getUserBookings
);

// Get user's active reservations
router.get('/reservations/active',
  authenticateToken,
  getActiveReservations
);

// ========================================
// LEGACY SUPPORT (for backward compatibility)
// ========================================

// Legacy general booking (without seat selection)
router.post('/legacy/book',
  authenticateToken,
  validate(schemas.createBooking),
  createBooking
);

module.exports = router;