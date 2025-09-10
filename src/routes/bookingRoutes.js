const express = require('express');
const bookingController = require('../controllers/bookingController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

router.get('/', authenticateToken, bookingController.getBookings);
router.post('/', authenticateToken, validate(schemas.createBooking), bookingController.createBooking);
router.delete('/:bookingId', authenticateToken, bookingController.cancelBooking);

module.exports = router;