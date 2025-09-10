const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { MESSAGES } = require('../utils/constants');
const logger = require('../utils/logger');

class AuthController {
  constructor() {
    // Bind methods to maintain 'this' context
    this.register = this.register.bind(this);
    this.registerAdmin = this.registerAdmin.bind(this);
    this.login = this.login.bind(this);
    this.getProfile = this.getProfile.bind(this);
    this.checkAdminExists = this.checkAdminExists.bind(this);
    this.changePassword = this.changePassword.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
  }

  async register(req, res, next) {
    try {
      const { email, password, name, phone } = req.body;
      
      // Check if user exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: MESSAGES.ERROR.EMAIL_EXISTS || 'Email already exists'
        });
      }

      // Create user
      const user = await User.create({ email, password, name, phone });

      // Generate JWT token
      const token = this.generateToken(user);

      logger.info(`User registered: ${user.email}`);

      res.status(201).json({
        success: true,
        message: MESSAGES.SUCCESS.USER_REGISTERED || 'User registered successfully',
        data: {
          user: this.sanitizeUser(user),
          token
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async registerAdmin(req, res, next) {
    try {
      const { email, password, name, phone, adminCode } = req.body;
      
      // Optional: Check admin creation code
      if (process.env.ADMIN_CREATION_CODE && adminCode !== process.env.ADMIN_CREATION_CODE) {
        return res.status(403).json({
          success: false,
          message: 'Invalid admin creation code',
          code: 'INVALID_ADMIN_CODE'
        });
      }
      
      // Check if user with this email already exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists',
          code: 'EMAIL_EXISTS'
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

      // Generate JWT token
      const token = this.generateToken(adminUser);

      logger.info(`Admin user created: ${adminUser.email}`);

      res.status(201).json({
        success: true,
        message: 'Admin user created successfully',
        data: {
          user: this.sanitizeUser(adminUser),
          token
        }
      });
    } catch (error) {
      logger.error('Admin registration error:', error);
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // Find user with password
      const user = await User.scope('withPassword').findOne({ where: { email } });

      if (!user || !await user.validatePassword(password)) {
        return res.status(401).json({
          success: false,
          message: MESSAGES.ERROR.INVALID_CREDENTIALS || 'Invalid credentials'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      // Generate JWT token
      const token = this.generateToken(user);

      logger.info(`User logged in: ${user.email}`);

      res.json({
        success: true,
        message: MESSAGES.SUCCESS.LOGIN_SUCCESS || 'Login successful',
        data: {
          user: this.sanitizeUser(user),
          token
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req, res, next) {
    try {
      const user = await User.findByPk(req.user.id);
      
      res.json({
        success: true,
        data: { user: this.sanitizeUser(user) }
      });
    } catch (error) {
      next(error);
    }
  }

  async checkAdminExists(req, res, next) {
    try {
      const adminCount = await User.count({ where: { role: 'ADMIN' } });
      
      res.json({
        success: true,
        data: {
          adminExists: adminCount > 0,
          adminCount,
          message: adminCount > 0 ? 'Admin users exist in the system' : 'No admin users found'
        }
      });
    } catch (error) {
      logger.error('Check admin exists error:', error);
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      
      const user = await User.scope('withPassword').findByPk(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Validate current password
      const isValidPassword = await user.validatePassword(currentPassword);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Update password
      await user.update({ password: newPassword });

      logger.info(`Password changed for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const { name, phone } = req.body;
      
      const user = await User.findByPk(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const updateData = {};
      if (name) updateData.name = name.trim();
      if (phone) updateData.phone = phone.trim();

      await user.update(updateData);

      logger.info(`Profile updated for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: { user: this.sanitizeUser(user) }
      });
    } catch (error) {
      next(error);
    }
  }

  // Helper methods (note: no underscore prefix needed)
  generateToken(user) {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        issuer: 'evently-api',
        audience: 'evently-client'
      }
    );
  }

  sanitizeUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      isActive: user.isActive,
      createdAt: user.createdAt
    };
  }
}

module.exports = new AuthController();
