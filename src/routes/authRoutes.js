const express = require('express');
const authController = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.post('/register', validate(schemas.register), authController.register);
router.post('/register-admin', validate(schemas.adminRegister), authController.registerAdmin);
router.post('/login', validate(schemas.login), authController.login);
router.get('/admin-exists', authController.checkAdminExists);

// Protected routes (require authentication)
router.use(authenticateToken); // Apply to all routes below

router.get('/profile', authController.getProfile);
router.put('/profile', authController.updateProfile);
router.put('/change-password', authController.changePassword);

module.exports = router;
