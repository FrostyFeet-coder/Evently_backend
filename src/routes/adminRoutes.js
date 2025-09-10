const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

// Make user admin
router.patch('/users/:userId/make-admin', adminController.makeUserAdmin);

// Create admin user
router.post('/users', validate(schemas.register), adminController.createAdminUser);

// Get all users
router.get('/users', adminController.getAllUsers);

// Update user role
router.patch('/users/:userId/role', adminController.updateUserRole);

// Toggle user active status
router.patch('/users/:userId/status', adminController.toggleUserStatus);

// Get user details
router.get('/users/:userId', adminController.getUserDetails);

module.exports = router;
