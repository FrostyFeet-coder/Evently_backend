const express = require('express');
const eventController = require('../controllers/eventController');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

router.get('/', eventController.getEvents);
router.get('/:eventId', eventController.getEvent);
router.get('/:eventId/stats', authenticateToken, eventController.getEventStats);

router.post('/', authenticateToken, validate(schemas.createEvent), eventController.createEvent);
router.put('/:eventId', authenticateToken, eventController.updateEvent);

module.exports = router;
