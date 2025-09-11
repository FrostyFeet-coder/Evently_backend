// src/routes/bookingRoutes.js
const express = require('express');
const bookingController = require('../controllers/bookingController');
const ticketController = require('../controllers/ticketController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

// BookMyShow-style booking flow
router.get('/events/:eventId/seats', bookingController.getSeatMap);
router.post('/select-seats', authenticateToken, validate(schemas.selectSeats), bookingController.selectSeats);
router.post('/:bookingId/confirm', authenticateToken, validate(schemas.confirmBooking), bookingController.confirmBooking);
router.delete('/:bookingId/cancel', authenticateToken, bookingController.cancelBooking);

// User bookings
router.get('/my-bookings', authenticateToken, bookingController.getUserBookings);

// QR Tickets
router.get('/:bookingId/ticket', authenticateToken, ticketController.getTicket);
router.get('/validate/:ticketHash', ticketController.validateTicket);

module.exports = router;
