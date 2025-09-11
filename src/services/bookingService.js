// src/services/bookingService.js
const { sequelize } = require('../config/database');
const { Event, Booking } = require('../models');
const { lock } = require('../config/redis'); // Redis-based lock helper
const logger = require('../utils/logger');
const { Op } = require('sequelize');

class BookingService {
  /**
   * Create a seat selection booking safely using Redis lock
   * @param {number} userId 
   * @param {number} eventId 
   * @param {Array} seatNumbers 
   * @param {string} seatSection 
   * @param {string} seatRow 
   * @returns {Booking} booking instance
   */
  async selectSeats(userId, eventId, seatNumbers, seatSection, seatRow) {
    const lockKey = `event:${eventId}`;
    const lockTimeout = 30000; // 30 seconds

    // Acquire Redis lock
    const lockInfo = await lock.acquire(lockKey, lockTimeout);
    if (!lockInfo) {
      throw new Error('Too many requests. Try again.');
    }

    const transaction = await sequelize.transaction();

    try {
      const event = await Event.findByPk(eventId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      if (!event) throw new Error('Event not found');

      // Check seat availability
      const unavailableSeats = await this.checkSeatAvailability(
        eventId, seatNumbers, seatSection, seatRow
      );

      if (unavailableSeats.length > 0) {
        throw new Error(`Seats unavailable: ${unavailableSeats.join(', ')}`);
      }

      const booking = await Booking.create({
        bookingNumber: `BKG${Date.now()}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        userId,
        eventId,
        seatNumbers,
        seatSection,
        seatRow,
        ticketCount: seatNumbers.length,
        bookingType: 'SEAT_SELECTION',
        unitPrice: event.price,
        totalAmount: event.price * seatNumbers.length,
        status: 'SEAT_SELECTED',
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
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

  /**
   * Confirm booking safely (payment + seat update)
   * @param {Booking} booking 
   * @returns {Booking} confirmed booking
   */
  async confirmBooking(booking) {
    const lockKey = `event:${booking.eventId}`;
    const lockTimeout = 30000;

    const lockInfo = await lock.acquire(lockKey, lockTimeout);
    if (!lockInfo) throw new Error('Too many requests. Try again.');

    const transaction = await sequelize.transaction();

    try {
      const event = await Event.findByPk(booking.eventId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!event) throw new Error('Event not found');

      // Double-check seat availability in case someone else booked
      const unavailableSeats = await this.checkSeatAvailability(
        booking.eventId, booking.seatNumbers, booking.seatSection, booking.seatRow
      );

      if (unavailableSeats.length > 0) {
        throw new Error(`Seats unavailable during confirmation: ${unavailableSeats.join(', ')}`);
      }

      // Update booking
      await booking.update({
        status: 'CONFIRMED',
        confirmedAt: new Date()
      }, { transaction });

      await transaction.commit();
      logger.info(`Booking confirmed: ${booking.bookingNumber}`);

      return booking;
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      await lock.release(lockInfo.key, lockInfo.value);
    }
  }

  /**
   * Check seat availability helper
   */
  async checkSeatAvailability(eventId, seatNumbers, seatSection, seatRow) {
    const bookedSeats = await Booking.findAll({
      where: {
        eventId,
        seatSection,
        seatRow,
        status: { [Op.in]: ['CONFIRMED', 'SEAT_SELECTED', 'RESERVED'] },
        [Op.or]: [
          { reservationExpiresAt: null },
          { reservationExpiresAt: { [Op.gt]: new Date() } }
        ]
      },
      attributes: ['seatNumbers']
    });

    const unavailable = [];
    bookedSeats.forEach(booking => {
      if (booking.seatNumbers && Array.isArray(booking.seatNumbers)) {
        booking.seatNumbers.forEach(seat => {
          if (seatNumbers.includes(seat)) unavailable.push(seat);
        });
      }
    });

    return unavailable;
  }
}

module.exports = new BookingService();
