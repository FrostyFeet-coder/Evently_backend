const express = require('express');
const waitlistController = require('../controllers/waitlistController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticateToken, waitlistController.joinWaitlist);
router.delete('/:eventId', authenticateToken, waitlistController.leaveWaitlist);
router.get('/:eventId/position', authenticateToken, waitlistController.getWaitlistPosition);

module.exports = router;
