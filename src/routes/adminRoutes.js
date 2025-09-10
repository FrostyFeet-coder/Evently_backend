const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

// Admin user management
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.post('/users', validate(schemas.adminRegister || schemas.register), adminController.createAdminUser);
router.patch('/users/:userId/make-admin', adminController.makeUserAdmin);
router.patch('/users/:userId/role', adminController.updateUserRole);
router.patch('/users/:userId/status', adminController.toggleUserStatus);

module.exports = router;
