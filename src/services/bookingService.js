const { sequelize } = require('../config/database');
const { Event, Booking } = require('../models');
const { lock } = require('../config/redis');
const logger = require('../utils/logger');

class BookingService {
  async createBooking(userId, eventId, ticketCount) {
    const lockResource = `event:${eventId}`;
    const lockInfo = await lock.acquire(lockResource, 30000);
    
    if (!lockInfo) {
      throw new Error('Unable to acquire lock. Please try again.');
    }

    const transaction = await sequelize.transaction();

    try {
      // Fetch event with lock
      const event = await Event.findByPk(eventId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!event) {
        throw new Error('Event not found');
      }

      // Check seat availability
      if (event.availableSeats < ticketCount) {
        throw new Error('Insufficient seats available');
      }

      // Calculate total amount
      const totalAmount = event.price * ticketCount;
      const expiresAt = new Date(Date.now() + (parseInt(process.env.BOOKING_EXPIRY_MINUTES) || 15) * 60 * 1000);

      // Create booking
      const booking = await Booking.create({
        userId,
        eventId,
        ticketCount,
        totalAmount,
        currency: event.currency,
        expiresAt
      }, { transaction });

      // Update available seats
      await event.update({
        availableSeats: event.availableSeats - ticketCount
      }, { transaction });

      await transaction.commit();

      logger.info(`Booking created: ${booking.bookingNumber}`);
      return booking;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      await lock.release(lockInfo.key, lockInfo.value);
    }
  }

  async cancelBooking(bookingId, userId, reason) {
    const transaction = await sequelize.transaction();

    try {
      const booking = await Booking.findOne({
        where: { id: bookingId, userId },
        include: [{ model: Event, as: 'event' }],
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!booking) {
        throw new Error('Booking not found');
      }

      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
        throw new Error('Booking cannot be cancelled');
      }

      // Update booking status
      await booking.update({
        status: 'CANCELLED'
      }, { transaction });

      // Return seats to availability
      await booking.event.update({
        availableSeats: booking.event.availableSeats + booking.ticketCount
      }, { transaction });

      await transaction.commit();

      logger.info(`Booking cancelled: ${booking.bookingNumber}`);
      return booking;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

module.exports = { BookingService };
