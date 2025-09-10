const { Booking, Event, User } = require('../models');
const { sequelize } = require('../config/database');
const { lock } = require('../config/redis');
const { MESSAGES } = require('../utils/constants');
const logger = require('../utils/logger');

class BookingController {
  async createBooking(req, res, next) {
    try {
      const { eventId, ticketCount } = req.body;
      const userId = req.user.id;

      console.log(' Creating booking:', { userId, eventId, ticketCount });

      // Validate event exists and is bookable
      const event = await Event.findByPk(eventId);
      if (!event) {
        return res.status(404).json({
          success: false,
          message: 'Event not found'
        });
      }

      if (!event.isBookable()) {
        return res.status(400).json({
          success: false,
          message: 'Event is not available for booking',
          details: { status: event.status, availableSeats: event.availableSeats }
        });
      }

      // Acquire lock for concurrency control
      const lockResource = `event:${eventId}`;
      const lockInfo = await lock.acquire(lockResource, 30000);
      
      if (!lockInfo) {
        return res.status(500).json({
          success: false,
          message: 'Unable to process booking. Please try again.'
        });
      }

      const transaction = await sequelize.transaction();

      try {
        // Re-fetch event with lock
        const lockedEvent = await Event.findByPk(eventId, {
          lock: transaction.LOCK.UPDATE,
          transaction
        });

        // Check seat availability
        if (lockedEvent.availableSeats < ticketCount) {
          await transaction.rollback();
          await lock.release(lockInfo.key, lockInfo.value);
          
          return res.status(409).json({
            success: false,
            message: 'Insufficient seats available',
            availableSeats: lockedEvent.availableSeats
          });
        }

        // Create booking
        const totalAmount = lockedEvent.price * ticketCount;
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        const booking = await Booking.create({
          userId,
          eventId,
          ticketCount,
          totalAmount,
          currency: 'USD',
          expiresAt,
          status: 'PENDING'
        }, { transaction });

        // Update available seats
        await lockedEvent.update({
          availableSeats: lockedEvent.availableSeats - ticketCount
        }, { transaction });

        await transaction.commit();
        await lock.release(lockInfo.key, lockInfo.value);

        console.log(' Booking created:', booking.bookingNumber);

        res.status(201).json({
          success: true,
          message: 'Booking created successfully',
          data: { booking }
        });

      } catch (error) {
        await transaction.rollback();
        await lock.release(lockInfo.key, lockInfo.value);
        throw error;
      }

    } catch (error) {
      console.error(' Booking error:', error);
      next(error);
    }
  }

  async getBookings(req, res, next) {
    try {
      const bookings = await Booking.findAll({
        where: { userId: req.user.id },
        include: [{
          model: Event,
          as: 'event',
          attributes: ['id', 'name', 'venue', 'dateTime']
        }],
        order: [['createdAt', 'DESC']]
      });

      res.json({
        success: true,
        data: { bookings }
      });
    } catch (error) {
      next(error);
    }
  }

  // ADD THIS MISSING METHOD
async cancelBooking(req, res, next) {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    console.log(' Cancelling booking:', bookingId, 'by user:', req.user.id);

    const transaction = await sequelize.transaction();

    try {
      // First, find the booking without lock and include
      const booking = await Booking.findOne({
        where: { id: bookingId, userId: req.user.id },
        include: [{ model: Event, as: 'event' }],
        transaction
      });

      if (!booking) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Booking not found or not authorized'
        });
      }

      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Booking cannot be cancelled',
          currentStatus: booking.status
        });
      }

      // Now lock the booking and event separately
      const lockedBooking = await Booking.findByPk(bookingId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      const lockedEvent = await Event.findByPk(booking.eventId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!lockedBooking || !lockedEvent) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Booking or event not found'
        });
      }

      // Update booking status
      await lockedBooking.update({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason || 'User requested cancellation'
      }, { transaction });

      // Return seats to availability
      await lockedEvent.update({
        availableSeats: lockedEvent.availableSeats + booking.ticketCount
      }, { transaction });

      await transaction.commit();

      console.log(' Booking cancelled:', booking.bookingNumber);

      // Fetch updated booking with event details for response
      const updatedBooking = await Booking.findByPk(bookingId, {
        include: [{ model: Event, as: 'event', attributes: ['id', 'name', 'venue'] }]
      });

      res.json({
        success: true,
        message: 'Booking cancelled successfully',
        data: { booking: updatedBooking }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error(' Cancel booking error:', error);
    next(error);
  }
}
}
module.exports = new BookingController();
