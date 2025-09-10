const { Waitlist, Event, User } = require('../models');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

class WaitlistController {
  async joinWaitlist(req, res, next) {
    try {
      const { eventId } = req.body;
      const userId = req.user.id;

      console.log(' Adding user to waitlist:', { userId, eventId });

      // Validate event exists
      const event = await Event.findByPk(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }

      // Check if event is actually full
      if (event.availableSeats > 0) {
        return res.status(400).json({
          success: false,
          message: 'Event still has available seats. Please book directly.',
          data: { availableSeats: event.availableSeats }
        });
      }

      const transaction = await sequelize.transaction();

      try {
        // Check if user is already on waitlist
        const existingEntry = await Waitlist.findOne({
          where: { userId, eventId, status: 'WAITING' },
          transaction
        });

        if (existingEntry) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            message: 'User is already on the waitlist',
            data: { position: existingEntry.position }
          });
        }

        // Get next position in waitlist
        const maxPosition = await Waitlist.max('position', {
          where: { eventId, status: 'WAITING' },
          transaction
        });

        const position = (maxPosition || 0) + 1;

        // Create waitlist entry
        const waitlistEntry = await Waitlist.create({
          userId,
          eventId,
          position,
          ticketsRequested: 1, // Default to 1, can be customized
          status: 'WAITING'
        }, { transaction });

        await transaction.commit();

        console.log(' User added to waitlist:', { userId, eventId, position });

        res.status(201).json({
          success: true,
          message: 'Added to waitlist successfully',
          data: {
            waitlistEntry: {
              id: waitlistEntry.id,
              position: waitlistEntry.position,
              ticketsRequested: waitlistEntry.ticketsRequested,
              status: waitlistEntry.status,
              estimatedWaitTime: position * 5 + ' minutes'
            }
          }
        });

      } catch (error) {
        await transaction.rollback();
        throw error;
      }

    } catch (error) {
      console.error(' Waitlist join error:', error);
      next(error);
    }
  }

  async leaveWaitlist(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = req.user.id;

      console.log('🚪 Removing user from waitlist:', { userId, eventId });

      const transaction = await sequelize.transaction();

      try {
        const waitlistEntry = await Waitlist.findOne({
          where: { userId, eventId, status: 'WAITING' },
          transaction
        });

        if (!waitlistEntry) {
          await transaction.rollback();
          return res.status(404).json({
            success: false,
            message: 'User is not on the waitlist for this event'
          });
        }

        const removedPosition = waitlistEntry.position;

        // Remove from waitlist (mark as expired)
        await waitlistEntry.update({ status: 'EXPIRED' }, { transaction });

        // Update positions for users after the removed user
        await Waitlist.update(
          { position: sequelize.literal('position - 1') },
          {
            where: {
              eventId,
              position: { [Op.gt]: removedPosition },
              status: 'WAITING'
            },
            transaction
          }
        );

        await transaction.commit();

        console.log(' User removed from waitlist:', { userId, eventId, removedPosition });

        res.json({
          success: true,
          message: 'Removed from waitlist successfully'
        });

      } catch (error) {
        await transaction.rollback();
        throw error;
      }

    } catch (error) {
      console.error(' Waitlist leave error:', error);
      next(error);
    }
  }

  async getWaitlistPosition(req, res, next) {
    try {
      const { eventId } = req.params;
      const userId = req.user.id;

      console.log(' Getting waitlist position:', { userId, eventId });

      const entry = await Waitlist.findOne({
        where: { userId, eventId, status: 'WAITING' },
        include: [{
          model: Event,
          as: 'event',
          attributes: ['id', 'name', 'venue', 'availableSeats']
        }]
      });

      if (!entry) {
        return res.status(404).json({
          success: false,
          message: 'Not on waitlist for this event'
        });
      }

      res.json({
        success: true,
        data: {
          position: entry.position,
          ticketsRequested: entry.ticketsRequested,
          estimatedWaitTime: `${entry.position * 5} minutes`,
          joinedAt: entry.createdAt,
          event: entry.event
        }
      });

    } catch (error) {
      console.error(' Get waitlist position error:', error);
      next(error);
    }
  }

  async getEventWaitlist(req, res, next) {
    try {
      const { eventId } = req.params;

      // Check if user is authorized (event creator or admin)
      const event = await Event.findByPk(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }

      if (event.createdBy !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view waitlist for this event'
        });
      }

      const waitlist = await Waitlist.findAll({
        where: { eventId, status: 'WAITING' },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email']
        }],
        order: [['position', 'ASC']]
      });

      res.json({
        success: true,
        data: {
          eventId,
          waitlistCount: waitlist.length,
          waitlist: waitlist.map(entry => ({
            id: entry.id,
            position: entry.position,
            ticketsRequested: entry.ticketsRequested,
            joinedAt: entry.createdAt,
            user: entry.user
          }))
        }
      });

    } catch (error) {
      console.error(' Get event waitlist error:', error);
      next(error);
    }
  }
}

module.exports = new WaitlistController();
