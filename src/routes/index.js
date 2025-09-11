const express = require('express');
const authRoutes = require('./authRoutes');
const eventRoutes = require('./eventRoutes');
const bookingRoutes = require('./bookingRoutes');
const waitlistRoutes = require('./waitlistRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const adminRoutes = require('./adminRoutes'); // Add this line
const seatRoutes = require('./seatRoutes');
const router = express.Router();

// API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Evently API',
    version: '1.0.0',
    endpoints: {
      auth: '/auth',
      events: '/events',
      bookings: '/bookings',
      waitlist: '/waitlist',
      analytics: '/analytics',
      admin: '/admin' // Add this line
    }
  });
});

// Route modules
router.use('/auth', authRoutes);
router.use('/events', eventRoutes);
router.use('/bookings', bookingRoutes);
router.use('/waitlist', waitlistRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/admin', adminRoutes); // Add this line

module.exports = router;
