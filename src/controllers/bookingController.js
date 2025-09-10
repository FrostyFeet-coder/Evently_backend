// src/controllers/bookingController.js - PRODUCTION BOOKING CONTROLLER
const { Booking, Event, User, Seat, Waitlist } = require('../models');
const { sequelize } = require('../config/database');
const { lock } = require('../config/redis');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const realtimeService = require('../services/realtimeService');

/**
 * Reserve seats temporarily for 15 minutes
 * Implements BookMyShow-style seat reservation with concurrency control
 * 
 * @param {Object} req - Express request object containing eventId, selectedSeats, bookingType
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const reserveSeats = async (req, res, next) => {
  try {
    const { eventId, selectedSeats, bookingType = 'SEAT_SELECTION' } = req.body;
    const userId = req.user.id;

    console.log('Reserving seats:', { userId, eventId, selectedSeats, bookingType });

    // Input validation
    if (!eventId || !selectedSeats || selectedSeats.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Event ID and selected seats are required'
      });
    }

    // Enforce maximum seat selection limit
    if (selectedSeats.length > 10) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 10 seats can be reserved at once'
      });
    }

    // Retrieve event information and validate availability
    const event = await Event.findByPk(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if event is currently bookable
    if (event.status !== 'PUBLISHED' || new Date() > new Date(event.dateTime)) {
      return res.status(400).json({
        success: false,
        message: 'Event is not available for booking'
      });
    }

    // Prevent multiple active reservations per user per event
    const existingReservation = await Booking.findOne({
      where: {
        userId,
        eventId,
        status: 'RESERVED',
        reservationExpiresAt: { [Op.gt]: new Date() }
      }
    });

    if (existingReservation) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active reservation for this event',
        data: {
          existingBookingId: existingReservation.id,
          timeRemaining: existingReservation.formatTimeRemaining()
        }
      });
    }

    // Acquire distributed lock to prevent race conditions during seat reservation
    const lockKey = `event_booking:${eventId}`;
    const lockInfo = await lock.acquire(lockKey, 30000); // 30-second timeout

    if (!lockInfo) {
      return res.status(429).json({
        success: false,
        message: 'High demand detected. Please try again in a moment.',
        retryAfter: 2000
      });
    }

    // Begin database transaction for atomic operations
    const transaction = await sequelize.transaction();

    try {
      let totalAmount = 0;
      let seatsToReserve = [];

      if (bookingType === 'SEAT_SELECTION') {
        // Handle specific seat selection with SELECT FOR UPDATE to prevent overselling
        const seats = await Seat.findAll({
          where: { 
            id: { [Op.in]: selectedSeats },
            eventId,
            isBooked: false,
            [Op.or]: [
              { isReserved: false },
              { 
                isReserved: true,
                reserveExpiresAt: { [Op.lt]: new Date() }
              }
            ]
          },
          lock: transaction.LOCK.UPDATE, // Pessimistic locking
          transaction
        });

        // Verify all requested seats are available
        if (seats.length !== selectedSeats.length) {
          await transaction.rollback();
          await lock.release(lockInfo.key, lockInfo.value);

          const foundIds = seats.map(s => s.id);
          const unavailableSeats = selectedSeats.filter(id => !foundIds.includes(id));

          return res.status(409).json({
            success: false,
            message: 'Some seats are no longer available',
            data: {
              availableSeats: foundIds,
              unavailableSeats
            }
          });
        }

        // Calculate total booking amount
        totalAmount = seats.reduce((sum, seat) => sum + parseFloat(seat.price), 0);
        seatsToReserve = seats;

        // Mark seats as temporarily reserved with expiration timestamp
        await Seat.update({
          isReserved: true,
          reservedBy: userId,
          reservedAt: new Date(),
          reserveExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from now
          version: sequelize.literal('version + 1') // Optimistic locking increment
        }, {
          where: { id: { [Op.in]: selectedSeats } },
          transaction
        });

      } else {
        // Handle general admission booking without specific seat assignment
        const ticketCount = parseInt(selectedSeats[0]) || 1;
        
        if (event.availableSeats < ticketCount) {
          await transaction.rollback();
          await lock.release(lockInfo.key, lockInfo.value);

          return res.status(409).json({
            success: false,
            message: 'Not enough seats available',
            data: {
              availableSeats: event.availableSeats,
              requestedSeats: ticketCount
            }
          });
        }

        totalAmount = parseFloat(event.price) * ticketCount;

        // Update event capacity counters
        await event.update({
          availableSeats: event.availableSeats - ticketCount,
          reservedSeats: (event.reservedSeats || 0) + ticketCount
        }, { transaction });
      }

      // Create booking record with temporary reservation status
      const booking = await Booking.create({
        bookingNumber: `EVT-${Date.now()}-${userId.substring(0, 8)}`,
        userId,
        eventId,
        ticketCount: bookingType === 'SEAT_SELECTION' ? seatsToReserve.length : parseInt(selectedSeats[0]) || 1,
        totalAmount,
        currency: 'USD',
        bookingType,
        status: 'RESERVED', // Temporary status pending payment
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        seatDetails: bookingType === 'SEAT_SELECTION' ? JSON.stringify(seatsToReserve.map(s => ({
          id: s.id,
          seatNumber: s.seatNumber,
          section: s.section,
          row: s.row,
          price: parseFloat(s.price)
        }))) : null,
        paymentStatus: 'PENDING'
      }, { transaction });

      await transaction.commit();
      await lock.release(lockInfo.key, lockInfo.value);

      console.log('Seats reserved successfully:', booking.bookingNumber);

      // Schedule automatic cleanup of reservation after expiration
      const bookingService = require('../services/bookingService');
      bookingService.scheduleReservationTimeout(booking.id, booking.reservationExpiresAt);

      // Broadcast real-time seat availability updates via WebSocket
      if (global.io) {
        realtimeService.broadcastSeatBooking({
          eventId,
          action: 'RESERVED',
          reservedSeats: seatsToReserve.map(s => s.seatNumber),
          remainingSeats: event.availableSeats - (bookingType === 'SEAT_SELECTION' ? 0 : parseInt(selectedSeats[0]) || 1),
          userId
        });
      }

      res.status(201).json({
        success: true,
        message: 'Seats reserved successfully. Complete payment within 15 minutes.',
        data: {
          reservationId: booking.id,
          bookingNumber: booking.bookingNumber,
          totalAmount: parseFloat(booking.totalAmount),
          currency: booking.currency,
          ticketCount: booking.ticketCount,
          expiresAt: booking.reservationExpiresAt,
          timeRemaining: booking.formatTimeRemaining(),
          reservedSeats: bookingType === 'SEAT_SELECTION' ? seatsToReserve.map(seat => ({
            id: seat.id,
            seatNumber: seat.seatNumber,
            section: seat.section,
            row: seat.row,
            price: parseFloat(seat.price)
          })) : null,
          nextStep: {
            action: 'CONFIRM_BOOKING',
            endpoint: `/api/bookings/${booking.id}/confirm`,
            paymentRequired: true
          }
        }
      });

    } catch (error) {
      await transaction.rollback();
      await lock.release(lockInfo.key, lockInfo.value);
      throw error;
    }

  } catch (error) {
    console.error('Reserve seats error:', error);
    next(error);
  }
};

/**
 * Confirm booking after successful payment processing
 * Converts temporary reservation to confirmed booking
 * 
 * @param {Object} req - Express request object containing payment details
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const confirmBooking = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { paymentDetails } = req.body;
    const userId = req.user.id;

    console.log('Confirming booking:', { bookingId, userId });

    // Retrieve booking with event information
    const booking = await Booking.findOne({
      where: { 
        id: bookingId,
        userId,
        status: 'RESERVED'
      },
      include: [
        { model: Event, as: 'event' }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found or expired'
      });
    }

    // Validate reservation hasn't expired
    if (new Date() > new Date(booking.reservationExpiresAt)) {
      return res.status(410).json({
        success: false,
        message: 'Reservation expired. Please try booking again.',
        expired: true
      });
    }

    // Acquire lock to prevent concurrent confirmation attempts
    const lockKey = `booking_confirm:${bookingId}`;
    const lockInfo = await lock.acquire(lockKey, 10000);

    if (!lockInfo) {
      return res.status(429).json({
        success: false,
        message: 'Please wait, processing your booking...'
      });
    }

    const transaction = await sequelize.transaction();

    try {
      // Process payment through integrated payment gateway
      const paymentResult = await processPayment(booking, paymentDetails);
      
      if (!paymentResult.success) {
        await transaction.rollback();
        await lock.release(lockInfo.key, lockInfo.value);
        
        return res.status(400).json({
          success: false,
          message: 'Payment failed: ' + paymentResult.error,
          paymentError: true
        });
      }

      // Update booking status to confirmed
      await booking.update({
        status: 'CONFIRMED',
        paymentStatus: 'COMPLETED',
        paymentId: paymentResult.paymentId,
        paymentMethod: paymentDetails?.method || 'CARD',
        confirmedAt: new Date(),
        reservationExpiresAt: null // Clear expiration
      }, { transaction });

      // Convert reserved seats to permanently booked
      if (booking.bookingType === 'SEAT_SELECTION') {
        const seatDetails = JSON.parse(booking.seatDetails || '[]');
        const seatIds = seatDetails.map(s => s.id);

        await Seat.update({
          isBooked: true,
          isReserved: false,
          bookedBy: userId,
          bookingId: booking.id,
          bookedAt: new Date(),
          reservedBy: null,
          reservedAt: null,
          reserveExpiresAt: null,
          version: sequelize.literal('version + 1')
        }, {
          where: { id: { [Op.in]: seatIds } },
          transaction
        });
      } else {
        // Update general admission counters
        await booking.event.update({
          reservedSeats: Math.max(0, (booking.event.reservedSeats || 0) - booking.ticketCount),
          bookedSeats: (booking.event.bookedSeats || 0) + booking.ticketCount
        }, { transaction });
      }

      await transaction.commit();
      await lock.release(lockInfo.key, lockInfo.value);

      console.log('Booking confirmed successfully:', booking.bookingNumber);

      // Send confirmation email with booking details
      const user = await User.findByPk(userId);
      await emailService.sendBookingConfirmation(user, booking, booking.event);

      // Broadcast booking confirmation via WebSocket
      if (global.io) {
        realtimeService.broadcastBookingUpdate({
          eventId: booking.eventId,
          eventName: booking.event.name,
          action: 'CONFIRMED',
          remainingSeats: booking.event.availableSeats,
          userId,
          ticketCount: booking.ticketCount
        });
      }

      res.json({
        success: true,
        message: 'Booking confirmed successfully!',
        data: {
          booking: {
            id: booking.id,
            bookingNumber: booking.bookingNumber,
            status: 'CONFIRMED',
            totalAmount: parseFloat(booking.totalAmount),
            ticketCount: booking.ticketCount,
            confirmedAt: booking.confirmedAt,
            paymentId: booking.paymentId
          },
          event: {
            id: booking.event.id,
            name: booking.event.name,
            venue: booking.event.venue,
            dateTime: booking.event.dateTime
          },
          nextSteps: [
            'Check your email for booking confirmation',
            'Download your tickets from the booking page',
            'Arrive 30 minutes early on event day'
          ]
        }
      });

    } catch (error) {
      await transaction.rollback();
      await lock.release(lockInfo.key, lockInfo.value);
      throw error;
    }

  } catch (error) {
    console.error('Confirm booking error:', error);
    next(error);
  }
};

/**
 * Retrieve seat map with real-time availability status
 * Shows current seat availability, pricing, and reservation status
 * 
 * @param {Object} req - Express request object containing eventId
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getSeatMap = async (req, res, next) => {
  try {
    const { eventId } = req.params;

    console.log('Getting seat map for event:', eventId);

    const event = await Event.findByPk(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Retrieve all seats with current booking status
    const seats = await Seat.findAll({
      where: { eventId },
      attributes: [
        'id', 'seatNumber', 'row', 'section', 'price', 'seatType',
        'isBooked', 'isReserved', 'reserveExpiresAt'
      ],
      order: [['section', 'ASC'], ['row', 'ASC'], ['seatNumber', 'ASC']]
    });

    if (seats.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Seat map not generated for this event',
        generateUrl: `/api/admin/events/${eventId}/generate-seats`
      });
    }

    // Process seat status with real-time availability calculation
    const currentTime = new Date();
    const processedSeats = seats.map(seat => {
      let status = 'AVAILABLE';
      
      if (seat.isBooked) {
        status = 'BOOKED';
      } else if (seat.isReserved) {
        // Check if reservation has expired
        if (currentTime > new Date(seat.reserveExpiresAt)) {
          status = 'AVAILABLE'; // Expired reservation
        } else {
          status = 'RESERVED';
        }
      }

      return {
        id: seat.id,
        seatNumber: seat.seatNumber,
        row: seat.row,
        section: seat.section,
        price: parseFloat(seat.price),
        seatType: seat.seatType,
        status,
        reservedUntil: seat.isReserved ? seat.reserveExpiresAt : null
      };
    });

    // Group seats by section and row for frontend rendering
    const seatMap = {};
    const stats = { total: 0, available: 0, booked: 0, reserved: 0 };

    processedSeats.forEach(seat => {
      if (!seatMap[seat.section]) seatMap[seat.section] = {};
      if (!seatMap[seat.section][seat.row]) seatMap[seat.section][seat.row] = [];

      seatMap[seat.section][seat.row].push(seat);

      // Calculate availability statistics
      stats.total++;
      if (seat.status === 'AVAILABLE') stats.available++;
      else if (seat.status === 'BOOKED') stats.booked++;
      else if (seat.status === 'RESERVED') stats.reserved++;
    });

    res.json({
      success: true,
      data: {
        eventId,
        eventName: event.name,
        eventDate: event.dateTime,
        seatMap,
        stats,
        legend: {
          AVAILABLE: 'Available for booking',
          BOOKED: 'Already booked',
          RESERVED: 'Temporarily reserved (expires in 15 min)',
          BLOCKED: 'Not available'
        },
        pricing: {
          sections: Object.keys(seatMap),
          priceRange: {
            min: Math.min(...processedSeats.map(s => s.price)),
            max: Math.max(...processedSeats.map(s => s.price))
          }
        }
      }
    });

  } catch (error) {
    console.error('Get seat map error:', error);
    next(error);
  }
};

/**
 * Manually release a seat reservation before expiration
 * Allows users to cancel their temporary reservation
 * 
 * @param {Object} req - Express request object containing bookingId
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const releaseReservation = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    console.log('Releasing reservation:', { bookingId, userId });

    const bookingService = require('../services/bookingService');
    const result = await bookingService.handleReservationTimeout(bookingId, userId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Reservation released successfully',
        data: {
          bookingId,
          releasedSeats: result.releasedSeats,
          releasedAt: new Date()
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    console.error('Release reservation error:', error);
    next(error);
  }
};

/**
 * Get real-time booking status with countdown timer
 * Returns current status and time remaining for reservations
 * 
 * @param {Object} req - Express request object containing bookingId
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getBookingStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      where: { 
        id: bookingId,
        userId
      },
      include: [
        { model: Event, as: 'event', attributes: ['id', 'name', 'venue', 'dateTime'] }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        timeRemaining: booking.getTimeRemaining(),
        timeRemainingFormatted: booking.formatTimeRemaining(),
        isActive: booking.isReservationActive(),
        canExtend: booking.status === 'RESERVED' && !booking.extensionUsed,
        event: booking.event
      }
    });

  } catch (error) {
    console.error('Get booking status error:', error);
    next(error);
  }
};

/**
 * Extend reservation by 5 additional minutes (one-time only)
 * Provides extra time for users experiencing payment difficulties
 * 
 * @param {Object} req - Express request object containing extension reason
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const extendReservation = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { reason = 'USER_REQUEST' } = req.body;
    const userId = req.user.id;

    console.log('Extending reservation:', { bookingId, userId, reason });

    const bookingService = require('../services/bookingService');
    const result = await bookingService.extendReservation(bookingId, userId, reason);

    res.json({
      success: true,
      message: 'Reservation extended by 5 minutes',
      data: {
        bookingId,
        newExpiryTime: result.newExpiryTime,
        timeRemaining: result.timeRemaining,
        extendedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Extend reservation error:', error);
    if (error.message.includes('already extended')) {
      return res.status(409).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Retrieve user's booking history with pagination and filtering
 * Supports filtering by status and date ranges
 * 
 * @param {Object} req - Express request object with query parameters
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUserBookings = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;

    let whereClause = { userId };
    if (status) {
      whereClause.status = status;
    }

    const bookings = await Booking.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Event,
          as: 'event',
          attributes: ['id', 'name', 'venue', 'dateTime', 'price']
        }
      ],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
      order: [['createdAt', 'DESC']]
    });

    // Process bookings with calculated fields
    const processedBookings = bookings.rows.map(booking => ({
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      ticketCount: booking.ticketCount,
      totalAmount: parseFloat(booking.totalAmount),
      paymentStatus: booking.paymentStatus,
      bookingType: booking.bookingType,
      createdAt: booking.createdAt,
      confirmedAt: booking.confirmedAt,
      timeRemaining: booking.status === 'RESERVED' ? booking.getTimeRemaining() : null,
      canExtend: booking.status === 'RESERVED' && !booking.extensionUsed,
      canCancel: booking.canBeCancelled(),
      event: booking.event,
      seatDetails: booking.seatDetails ? JSON.parse(booking.seatDetails) : null
    }));

    res.json({
      success: true,
      data: {
        bookings: processedBookings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(bookings.count / limit),
          totalItems: bookings.count
        }
      }
    });

  } catch (error) {
    console.error('Get user bookings error:', error);
    next(error);
  }
};

/**
 * Get user's currently active reservations
 * Returns all unexpired reservations awaiting confirmation
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getActiveReservations = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const activeReservations = await Booking.findAll({
      where: {
        userId,
        status: 'RESERVED',
        reservationExpiresAt: { [Op.gt]: new Date() }
      },
      include: [
        { model: Event, as: 'event', attributes: ['id', 'name', 'venue', 'dateTime'] }
      ],
      order: [['reservationExpiresAt', 'ASC']]
    });

    const processedReservations = activeReservations.map(booking => ({
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      ticketCount: booking.ticketCount,
      totalAmount: parseFloat(booking.totalAmount),
      expiresAt: booking.reservationExpiresAt,
      timeRemaining: booking.getTimeRemaining(),
      timeRemainingFormatted: booking.formatTimeRemaining(),
      canExtend: !booking.extensionUsed,
      event: booking.event,
      seatDetails: booking.seatDetails ? JSON.parse(booking.seatDetails) : null
    }));

    res.json({
      success: true,
      data: {
        reservations: processedReservations,
        totalActive: processedReservations.length
      }
    });

  } catch (error) {
    console.error('Get active reservations error:', error);
    next(error);
  }
};

/**
 * Cancel a booking and process refund if applicable
 * Handles both reserved and confirmed booking cancellations
 * 
 * @param {Object} req - Express request object containing cancellation details
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const cancelBooking = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { reason, comments } = req.body;
    const userId = req.user.id;

    console.log('Cancelling booking:', { bookingId, userId, reason });

    const booking = await Booking.findOne({
      where: { 
        id: bookingId,
        userId
      },
      include: [{ model: Event, as: 'event' }]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking can be cancelled based on business rules
    if (!booking.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        message: 'Booking cannot be cancelled'
      });
    }

    const transaction = await sequelize.transaction();

    try {
      // Calculate refund amount based on cancellation policy
      const refundAmount = booking.calculateRefundAmount();

      // Update booking status to cancelled
      await booking.update({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
        refundAmount
      }, { transaction });

      // Release associated seats back to inventory
      if (booking.bookingType === 'SEAT_SELECTION') {
        if (booking.status === 'RESERVED') {
          // Release reserved seats
          await Seat.releaseReservation(userId, booking.id, transaction);
        } else if (booking.status === 'CONFIRMED') {
          // Release permanently booked seats
          const seatDetails = JSON.parse(booking.seatDetails || '[]');
          const seatIds = seatDetails.map(s => s.id);

          await Seat.update({
            isBooked: false,
            bookedBy: null,
            bookingId: null,
            bookedAt: null,
            version: sequelize.literal('version + 1')
          }, {
            where: { id: { [Op.in]: seatIds } },
            transaction
          });
        }
      } else {
        // Release general admission capacity
        const seatsToRelease = booking.ticketCount;
        if (booking.status === 'RESERVED') {
          await booking.event.update({
            availableSeats: booking.event.availableSeats + seatsToRelease,
            reservedSeats: Math.max(0, (booking.event.reservedSeats || 0) - seatsToRelease)
          }, { transaction });
        } else {
          await booking.event.update({
            availableSeats: booking.event.availableSeats + seatsToRelease,
            bookedSeats: Math.max(0, (booking.event.bookedSeats || 0) - seatsToRelease)
          }, { transaction });
        }
      }

      await transaction.commit();

      console.log('Booking cancelled successfully:', booking.bookingNumber);

      // Broadcast seat availability update via WebSocket
      if (global.io) {
        realtimeService.broadcastBookingUpdate({
          eventId: booking.eventId,
          eventName: booking.event.name,
          action: 'CANCELLED',
          remainingSeats: booking.event.availableSeats + booking.ticketCount,
          userId
        });
      }

      res.json({
        success: true,
        message: 'Booking cancelled successfully',
        data: {
          bookingId: booking.id,
          bookingNumber: booking.bookingNumber,
          cancelledAt: booking.cancelledAt,
          refundAmount: parseFloat(refundAmount),
          refundStatus: 'PROCESSING'
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Cancel booking error:', error);
    next(error);
  }
};

/**
 * Retrieve detailed information for a specific booking
 * Returns complete booking details including event and user information
 * 
 * @param {Object} req - Express request object containing bookingId
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getBookingById = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      where: { 
        id: bookingId,
        userId
      },
      include: [
        { model: Event, as: 'event' },
        { model: User, as: 'user', attributes: ['id', 'name', 'email'] }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        ticketCount: booking.ticketCount,
        totalAmount: parseFloat(booking.totalAmount),
        paymentStatus: booking.paymentStatus,
        paymentId: booking.paymentId,
        paymentMethod: booking.paymentMethod,
        bookingType: booking.bookingType,
        createdAt: booking.createdAt,
        confirmedAt: booking.confirmedAt,
        timeRemaining: booking.status === 'RESERVED' ? booking.getTimeRemaining() : null,
        canExtend: booking.status === 'RESERVED' && !booking.extensionUsed,
        canCancel: booking.canBeCancelled(),
        event: booking.event,
        user: booking.user,
        seatDetails: booking.seatDetails ? JSON.parse(booking.seatDetails) : null
      }
    });

  } catch (error) {
    console.error('Get booking by ID error:', error);
    next(error);
  }
};

/**
 * Process payment through integrated payment gateway
 * Simulates payment processing with multiple payment methods
 * 
 * @param {Object} booking - Booking object requiring payment
 * @param {Object} paymentDetails - Payment method and credentials
 * @returns {Object} Payment result with success status and transaction details
 */
async function processPayment(booking, paymentDetails) {
  try {
    console.log('Processing payment for booking:', booking.bookingNumber);
    
    // Validate payment method and required fields
    if (!paymentDetails || !paymentDetails.method) {
      return { success: false, error: 'Payment method required' };
    }

    // Validate payment details based on selected method
    switch (paymentDetails.method) {
      case 'CARD':
        if (!paymentDetails.cardNumber || !paymentDetails.cardExpiry || !paymentDetails.cardCVV) {
          return { success: false, error: 'Card details incomplete' };
        }
        break;
      case 'UPI':
        if (!paymentDetails.upiId) {
          return { success: false, error: 'UPI ID required' };
        }
        break;
      case 'WALLET':
        if (!paymentDetails.walletId) {
          return { success: false, error: 'Wallet ID required' };
        }
        break;
      case 'NET_BANKING':
        if (!paymentDetails.bankCode) {
          return { success: false, error: 'Bank code required' };
        }
        break;
    }

    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate payment success rate (95% success in simulation)
    if (Math.random() < 0.95) {
      return {
        success: true,
        paymentId: `PAY_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        transactionId: `TXN_${booking.bookingNumber}_${Date.now()}`,
        method: paymentDetails.method,
        amount: booking.totalAmount,
        gateway: 'EVENTLY_PAY'
      };
    } else {
      return { 
        success: false, 
        error: 'Payment declined by bank' 
      };
    }

  } catch (error) {
    console.error('Payment processing error:', error);
    return { success: false, error: 'Payment processing failed' };
  }
}

module.exports = {
  // Enhanced booking flow
  reserveSeats,
  confirmBooking,
  getSeatMap,
  releaseReservation,
  
  // Booking management
  getBookingStatus,
  extendReservation,
  
  // User bookings
  getUserBookings,
  getActiveReservations,
  cancelBooking,
  getBookingById
};