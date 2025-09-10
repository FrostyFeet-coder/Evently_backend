const { sequelize } = require('../config/database');
const { Waitlist, Event, User } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

class WaitlistService {
  async addToWaitlist(userId, eventId, ticketsRequested = 1) {
    const transaction = await sequelize.transaction();

    try {
      // Check if user is already on waitlist
      const existingEntry = await Waitlist.findOne({
        where: { userId, eventId, status: 'WAITING' },
        transaction
      });

      if (existingEntry) {
        throw new Error('User is already on the waitlist');
      }

      // Get next position
      const maxPosition = await Waitlist.max('position', {
        where: { eventId, status: 'WAITING' },
        transaction
      });

      const position = (maxPosition || 0) + 1;

      const waitlistEntry = await Waitlist.create({
        userId,
        eventId,
        position,
        ticketsRequested,
        status: 'WAITING'
      }, { transaction });

      await transaction.commit();

      logger.info(`User ${userId} added to waitlist for event ${eventId} at position ${position}`);
      return waitlistEntry;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async removeFromWaitlist(userId, eventId) {
    const transaction = await sequelize.transaction();

    try {
      const waitlistEntry = await Waitlist.findOne({
        where: { userId, eventId, status: 'WAITING' },
        transaction
      });

      if (!waitlistEntry) {
        throw new Error('User is not on the waitlist');
      }

      const removedPosition = waitlistEntry.position;

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
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getWaitlistPosition(userId, eventId) {
    const entry = await Waitlist.findOne({
      where: { userId, eventId, status: 'WAITING' },
      attributes: ['position', 'ticketsRequested', 'createdAt']
    });

    if (!entry) {
      return null;
    }

    return {
      position: entry.position,
      ticketsRequested: entry.ticketsRequested,
      estimatedWaitTime: entry.position * 5, // 5 minutes per position
      joinedAt: entry.createdAt
    };
  }
}

module.exports = { WaitlistService };
