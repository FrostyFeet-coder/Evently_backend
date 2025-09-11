// src/routes/seatRoutes.js
const express = require('express');
const {
  generateSeatMap,
  getSeatMap,
  bookSpecificSeats,
  getAvailableSeats
} = require('../controllers/seatController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/:eventId/available', getAvailableSeats);
router.get('/:eventId', getSeatMap);

// Protected routes
router.use(authenticateToken);

// User routes
router.post('/book', bookSpecificSeats);

// Admin routes  
router.post('/:eventId/generate', generateSeatMap);

module.exports = router;