const { Event, User, Booking } = require('../models');
const { MESSAGES } = require('../utils/constants');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

class EventController {
  async getEvents(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        category,
        status = 'PUBLISHED'
      } = req.query;

      const whereClause = { status };

      if (search) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } },
          { venue: { [Op.iLike]: `%${search}%` } }
        ];
      }

      if (category) {
        whereClause.category = category;
      }

      const events = await Event.findAndCountAll({
        where: whereClause,
        include: [{
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        }],
        limit: parseInt(limit),
        offset: (page - 1) * limit,
        order: [['dateTime', 'ASC']]
      });

      res.json({
        success: true,
        data: {
          events: events.rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(events.count / limit),
            totalItems: events.count
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      
      const event = await Event.findByPk(eventId, {
        include: [{
          model: User,
          as: 'creator',
          attributes: ['id', 'name']
        }]
      });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: MESSAGES.ERROR.EVENT_NOT_FOUND
        });
      }

      res.json({
        success: true,
        data: { 
          event,
          isBookable: event.isBookable()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async createEvent(req, res, next) {
    try {
      const eventData = {
        ...req.body,
        createdBy: req.user.id,
        availableSeats: req.body.capacity
      };

      const event = await Event.create(eventData);

      logger.info(`Event created: ${event.name} by user ${req.user.id}`);

      res.status(201).json({
        success: true,
        message: MESSAGES.SUCCESS.EVENT_CREATED,
        data: { event }
      });
    } catch (error) {
      next(error);
    }
  }

  async updateEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      
      const event = await Event.findByPk(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: MESSAGES.ERROR.EVENT_NOT_FOUND
        });
      }

      // Check ownership or admin role
      if (event.createdBy !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this event'
        });
      }

      await event.update(req.body);

      logger.info(`Event updated: ${eventId} by user ${req.user.id}`);

      res.json({
        success: true,
        message: MESSAGES.SUCCESS.EVENT_UPDATED,
        data: { event }
      });
    } catch (error) {
      next(error);
    }
  }

  async getEventStats(req, res, next) {
    try {
      const { eventId } = req.params;
      
      const event = await Event.findByPk(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: MESSAGES.ERROR.EVENT_NOT_FOUND
        });
      }

      const bookingStats = await Booking.findAll({
        where: { eventId },
        attributes: [
          'status',
          [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count'],
          [require('sequelize').fn('SUM', require('sequelize').col('totalAmount')), 'revenue']
        ],
        group: ['status']
      });

      const totalBookings = bookingStats.reduce((sum, stat) => sum + parseInt(stat.dataValues.count), 0);
      const totalRevenue = bookingStats.reduce((sum, stat) => sum + parseFloat(stat.dataValues.revenue || 0), 0);

      res.json({
        success: true,
        data: {
          event: {
            id: event.id,
            name: event.name,
            capacity: event.capacity,
            availableSeats: event.availableSeats,
            bookedSeats: event.capacity - event.availableSeats
          },
          stats: {
            totalBookings,
            totalRevenue,
            capacityUtilization: ((event.capacity - event.availableSeats) / event.capacity * 100).toFixed(2),
            bookingsByStatus: bookingStats
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new EventController();
