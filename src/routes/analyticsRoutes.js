const express = require('express');
const { getDashboardStats, getBookingTrends, getEventAnalytics } = require('../controllers/analyticsController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', authenticateToken, getDashboardStats);
router.get('/booking-trends', authenticateToken, getBookingTrends);
router.get('/events', authenticateToken, getEventAnalytics);

module.exports = router;
