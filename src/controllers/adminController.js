const { User, Event, Booking } = require('../models');
const { MESSAGES, USER_ROLES } = require('../utils/constants');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

class AdminController {
  // Make a user admin
  async makeUserAdmin(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Only existing admins can make other users admin
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required'
        });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.role === 'ADMIN') {
        return res.status(400).json({
          success: false,
          message: 'User is already an admin'
        });
      }

      await user.update({ role: 'ADMIN' });

      logger.info(`User ${user.email} promoted to admin by ${req.user.email}`);

      res.json({
        success: true,
        message: 'User promoted to admin successfully',
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Create admin user directly
  async createAdminUser(req, res, next) {
    try {
      const { email, password, name, phone } = req.body;

      // Only existing admins can create new admin users
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required'
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists'
        });
      }

      // Create admin user
      const adminUser = await User.create({
        email,
        password,
        name,
        phone,
        role: 'ADMIN'
      });

      logger.info(`New admin user created: ${adminUser.email} by ${req.user.email}`);

      res.status(201).json({
        success: true,
        message: 'Admin user created successfully',
        data: {
          user: {
            id: adminUser.id,
            name: adminUser.name,
            email: adminUser.email,
            role: adminUser.role
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get all users (admin only)
  async getAllUsers(req, res, next) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required'
        });
      }

      const { page = 1, limit = 10, role, search } = req.query;
      
      const whereClause = {};
      
      if (role) {
        whereClause.role = role;
      }
      
      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const users = await User.findAndCountAll({
        where: whereClause,
        attributes: ['id', 'name', 'email', 'phone', 'role', 'isActive', 'createdAt'],
        limit: parseInt(limit),
        offset: (page - 1) * limit,
        order: [['createdAt', 'DESC']]
      });

      res.json({
        success: true,
        data: {
          users: users.rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(users.count / limit),
            totalItems: users.count
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Update user role
  async updateUserRole(req, res, next) {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required'
        });
      }

      if (!['USER', 'ADMIN'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role. Must be USER or ADMIN'
        });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Prevent admin from demoting themselves
      if (user.id === req.user.id && role === 'USER') {
        return res.status(400).json({
          success: false,
          message: 'Cannot change your own admin privileges'
        });
      }

      const oldRole = user.role;
      await user.update({ role });

      logger.info(`User ${user.email} role changed from ${oldRole} to ${role} by ${req.user.email}`);

      res.json({
        success: true,
        message: `User role updated to ${role} successfully`,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Deactivate/reactivate user
  async toggleUserStatus(req, res, next) {
    try {
      const { userId } = req.params;

      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required'
        });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Prevent admin from deactivating themselves
      if (user.id === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate your own account'
        });
      }

      const newStatus = !user.isActive;
      await user.update({ isActive: newStatus });

      const action = newStatus ? 'activated' : 'deactivated';
      logger.info(`User ${user.email} ${action} by ${req.user.email}`);

      res.json({
        success: true,
        message: `User ${action} successfully`,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isActive: user.isActive
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  // Get user details with stats
  async getUserDetails(req, res, next) {
    try {
      const { userId } = req.params;

      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required'
        });
      }

      const user = await User.findByPk(userId, {
        attributes: ['id', 'name', 'email', 'phone', 'role', 'isActive', 'createdAt']
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get user stats
      const [eventsCreated, totalBookings, activeBookings] = await Promise.all([
        Event.count({ where: { createdBy: userId } }),
        Booking.count({ where: { userId } }),
        Booking.count({ where: { userId, status: ['PENDING', 'CONFIRMED'] } })
      ]);

      res.json({
        success: true,
        data: {
          user,
          stats: {
            eventsCreated,
            totalBookings,
            activeBookings
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AdminController();
