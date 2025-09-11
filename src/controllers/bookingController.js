// src/controllers/bookingController.js - COMPLETE FIXED VERSION
const { Booking, Event, User } = require('../models');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const analyticsService = require('../services/analyticsService');
const { createError, asyncHandler } = require('../middleware/errorHandler');

class BookingController {
  // Step 1: Select seats and start 15-min timer
  selectSeats = asyncHandler(async (req, res) => {
    const {
      eventId,
      seatNumbers,
      seatSection,
      seatRow,
      bookingType = 'SEAT_SELECTION'
    } = req.body;
    
    const userId = req.user.id;

    // Validate event
    const event = await Event.findByPk(eventId);
    if (!event) {
      throw createError.notFound('Event not found');
    }

    // Check seat availability
    const unavailableSeats = await this.checkSeatAvailability(
      eventId, seatNumbers, seatSection, seatRow
    );

    if (unavailableSeats.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Some seats are no longer available',
        unavailableSeats
      });
    }

    const transaction = await sequelize.transaction();

    try {
      // Create booking with 15-minute timer
      const booking = await Booking.create({
        bookingNumber: this.generateBookingNumber(),
        userId,
        eventId,
        seatNumbers,
        seatSection,
        seatRow,
        ticketCount: seatNumbers.length,
        bookingType,
        unitPrice: event.price,
        totalAmount: event.price * seatNumbers.length,
        status: 'SEAT_SELECTED',
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
      }, { transaction });

      // Schedule auto-expiry
      this.scheduleExpiry(booking.id, booking.reservationExpiresAt);

      await transaction.commit();

      // Broadcast seat selection
      try {
        if (analyticsService && analyticsService.broadcastSeatActivity) {
          analyticsService.broadcastSeatActivity(eventId, 'SELECTED', {
            seatNumbers,
            userId,
            bookingId: booking.id
          });
        }
      } catch (analyticsError) {
        logger.warn('Analytics broadcast failed:', analyticsError.message);
      }

      res.status(201).json({
        success: true,
        message: 'Seats selected! Complete payment within 15 minutes.',
        data: {
          bookingId: booking.id,
          bookingNumber: booking.bookingNumber,
          seatNumbers: booking.seatNumbers,
          totalAmount: booking.totalAmount,
          expiresAt: booking.reservationExpiresAt,
          nextStep: 'PAYMENT'
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  });

confirmBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { paymentMethod = 'CARD', paymentDetails = {} } = req.body;
  const userId = req.user.id;

  logger.info('Confirm booking request:', { bookingId, userId, paymentMethod });

  // Find booking that is pending payment
  const booking = await Booking.findOne({
    where: {
      id: bookingId,
      userId,
      status: { [Op.in]: ['SEAT_SELECTED', 'RESERVED'] }
    },
    include: [
      { model: Event, as: 'event' },
      { model: User, as: 'user' }
    ]
  });

  if (!booking) throw createError.notFound('Booking not found or expired');

  // Check if reservation expired
  if (booking.reservationExpiresAt && new Date() > booking.reservationExpiresAt) {
    await booking.update({ status: 'EXPIRED' });
    throw createError.gone('Booking expired');
  }

  const transaction = await sequelize.transaction();

  try {
    // Process payment
    const paymentResult = await this.processPayment(booking, paymentMethod, paymentDetails);
    if (!paymentResult.success) {
      throw createError.badRequest(`Payment failed: ${paymentResult.error || 'Unknown error'}`);
    }

    // Generate ticket hash synchronously
    const ticketHash = this.generateTicketHash(booking.id, booking.bookingNumber);

    // Generate QR code data URL inside transaction before commit
    const QRCode = require('qrcode');
    const qrData = {
      bookingNumber: booking.bookingNumber,
      eventId: booking.eventId,
      userId: booking.userId,
      ticketHash,
      validation: `${process.env.BASE_URL}/api/tickets/validate/${ticketHash}`
    };
    const qrCode = await QRCode.toDataURL(JSON.stringify(qrData), {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Update booking with all info including qrCode and ticketHash atomically
    await booking.update({
      status: 'CONFIRMED',
      paymentStatus: 'COMPLETED',
      paymentId: paymentResult.paymentId,
      paymentMethod,
      reservationExpiresAt: null,
      ticketHash,
      qrCode
    }, { transaction });

    // Commit transaction
    await transaction.commit();
    logger.info('Booking confirmed successfully:', { bookingId, paymentId: paymentResult.paymentId });

    // Send response immediately after commit
    res.json({
      success: true,
      message: 'Booking confirmed! Check your email for tickets.',
      data: {
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        status: 'CONFIRMED',
        totalAmount: parseFloat(booking.totalAmount),
        paymentId: booking.paymentId,
        seatNumbers: booking.seatNumbers,
        event: {
          id: booking.event.id,
          name: booking.event.name,
          venue: booking.event.venue,
          dateTime: booking.event.dateTime
        },
        qrCode
      }
    });

    // Fire-and-forget async tasks not blocking response
    setImmediate(async () => {
      try {
        // Send confirmation email
        await emailService.sendBookingConfirmation(booking, booking.event, booking.user);

        // Broadcast booking analytics
        if (analyticsService.broadcastSeatActivity) {
          analyticsService.broadcastSeatActivity(booking.eventId, 'BOOKED', {
            seatNumbers: booking.seatNumbers,
            userId,
            bookingId: booking.id
          });
        }

        logger.info('Post-confirmation tasks completed:', { bookingId });
      } catch (postError) {
        logger.error('Post-confirmation tasks failed:', { bookingId, error: postError.message });
      }
    });

  } catch (error) {
    await transaction.rollback();
    logger.error('Booking confirmation failed:', { bookingId, error: error.message, stack: error.stack });
    throw error;
  }
});
  // FIXED: Separate method for post-confirmation tasks
  async handlePostConfirmationTasks(bookingData) {
    setTimeout(async () => {
      try {
        logger.info('Starting post-confirmation tasks:', { bookingId: bookingData.id });

        // Generate QR code
        await this.generateAndSaveQRCode(bookingData);
        logger.info('QR code generated successfully');

        // Send confirmation email
        if (emailService && emailService.sendBookingConfirmation) {
          // Fetch fresh instances for email
          const [event, user] = await Promise.all([
            Event.findByPk(bookingData.eventId),
            User.findByPk(bookingData.userId)
          ]);
          
          await emailService.sendBookingConfirmation(bookingData, event, user);
          logger.info('Confirmation email sent successfully');
        }

        // Broadcast analytics
        if (analyticsService && analyticsService.broadcastSeatActivity) {
          analyticsService.broadcastSeatActivity(bookingData.eventId, 'BOOKED', {
            seatNumbers: bookingData.seatNumbers,
            userId: bookingData.userId,
            bookingId: bookingData.id,
            timestamp: new Date()
          });
          logger.info('Analytics broadcast completed');
        }

        logger.info('All post-confirmation tasks completed successfully:', { 
          bookingId: bookingData.id 
        });

      } catch (postError) {
        logger.error('Post-confirmation tasks failed:', { 
          bookingId: bookingData.id, 
          error: postError.message,
          stack: postError.stack
        });
      }
    }, 100); // 100ms delay to ensure response is sent first
  }

  // FIXED: Generate and save QR code without transaction
  async generateAndSaveQRCode(bookingData) {
    try {
      const qrCode = await this.generateQRCodeSync(bookingData);
      
      // Update booking with QR code without transaction
      await Booking.update(
        { qrCode },
        { 
          where: { id: bookingData.id },
          transaction: null // Ensure no transaction is used
        }
      );
      
      logger.info('QR code saved successfully');
    } catch (error) {
      logger.error('Failed to generate or save QR code:', { 
        bookingId: bookingData.id, 
        error: error.message 
      });
    }
  }

  // FIXED: Generate ticket hash with better error handling
  generateTicketHash(bookingId, bookingNumber) {
    try {
      const crypto = require('crypto');
      const timestamp = Date.now();
      const randomBytes = crypto.randomBytes(8).toString('hex');
      
      return crypto
        .createHash('sha256')
        .update(`${bookingId}-${bookingNumber}-${timestamp}-${randomBytes}`)
        .digest('hex');
    } catch (error) {
      logger.error('Ticket hash generation failed:', { bookingId, error: error.message });
      // Fallback hash generation
      return `ticket_${bookingId}_${bookingNumber}_${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '');
    }
  }

  // FIXED: Synchronous QR generation (no DB update)
  async generateQRCodeSync(bookingData) {
    try {
      const QRCode = require('qrcode');
      
      const qrData = {
        bookingNumber: bookingData.bookingNumber,
        eventId: bookingData.eventId,
        userId: bookingData.userId,
        ticketHash: bookingData.ticketHash,
        validation: `${process.env.BASE_URL || 'https://yourapp.com'}/api/tickets/validate/${bookingData.ticketHash}`,
        timestamp: Date.now()
      };
      
      const qrCode = await QRCode.toDataURL(JSON.stringify(qrData), {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });
      
      logger.info('QR code generated successfully:', { 
        bookingId: bookingData.id 
      });
      
      return qrCode;
      
    } catch (error) {
      logger.error('QR code generation failed:', { 
        bookingId: bookingData.id, 
        error: error.message
      });
      throw error;
    }
  }

  // FIXED: Payment processing with better simulation and error handling
  async processPayment(booking, method, details) {
    try {
      logger.info('Starting payment processing:', { 
        bookingId: booking.id, 
        method,
        amount: booking.totalAmount 
      });
      
      // Validate payment details
      if (!booking || !booking.totalAmount || booking.totalAmount <= 0) {
        throw new Error('Invalid booking or amount');
      }

      // Simulate payment processing delay (reduced for faster testing)
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Simulate payment outcomes with higher success rate
      const random = Math.random();
      
      if (random > 0.98) { // 2% chance of timeout
        throw new Error('Payment gateway timeout - please try again');
      }
      
      if (random > 0.95) { // 3% chance of decline
        return {
          success: false,
          error: 'Payment declined by bank',
          paymentId: null,
          code: 'PAYMENT_DECLINED'
        };
      }
      
      // Success case - 95% success rate
      const paymentId = `PAY_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const transactionId = `TXN_${booking.bookingNumber}_${Date.now()}`;
      
      const result = {
        success: true,
        paymentId,
        transactionId,
        method,
        amount: parseFloat(booking.totalAmount),
        currency: 'USD',
        processedAt: new Date(),
        transactionFee: Math.round(booking.totalAmount * 0.029 * 100) / 100, // 2.9% fee
        netAmount: Math.round(booking.totalAmount * 0.971 * 100) / 100
      };
      
      logger.info('Payment processed successfully:', result);
      return result;
      
    } catch (error) {
      logger.error('Payment processing error:', { 
        bookingId: booking.id, 
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message || 'Payment processing failed',
        paymentId: null,
        code: 'PAYMENT_ERROR'
      };
    }
  }

  // Get seat map with real-time availability
  getSeatMap = asyncHandler(async (req, res) => {
    const { eventId } = req.params;

    const event = await Event.findByPk(eventId);
    if (!event) {
      throw createError.notFound('Event not found');
    }

    // Get current seat bookings
    const bookedSeats = await Booking.findAll({
      where: {
        eventId,
        status: { [Op.in]: ['CONFIRMED', 'SEAT_SELECTED', 'RESERVED'] },
        seatNumbers: { [Op.not]: null }
      },
      attributes: ['seatNumbers', 'seatSection', 'seatRow', 'status', 'reservationExpiresAt']
    });

    // Generate seat map (simulate venue layout)
    const seatMap = this.generateSeatMap(event, bookedSeats);

    res.json({
      success: true,
      data: {
        eventId,
        eventName: event.name,
        seatMap,
        legend: {
          available: 'Available for booking',
          selected: 'In your selection',
          booked: 'Already booked',
          blocked: 'Not available'
        }
      }
    });
  });

  // Cancel booking
  cancelBooking = asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      where: { id: bookingId, userId },
      include: [
        { model: Event, as: 'event' },
        { model: User, as: 'user' }
      ]
    });

    if (!booking) {
      throw createError.notFound('Booking not found');
    }

    const transaction = await sequelize.transaction();

    try {
      await booking.update({
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED'
      }, { transaction });

      await transaction.commit();

      // Non-transactional side effects
      setTimeout(async () => {
        try {
          if (emailService && emailService.sendCancellationEmail) {
            await emailService.sendCancellationEmail(booking, booking.event, booking.user);
          }

          if (analyticsService && analyticsService.broadcastSeatActivity) {
            analyticsService.broadcastSeatActivity(booking.eventId, 'RELEASED', {
              seatNumbers: booking.seatNumbers
            });
          }
        } catch (error) {
          logger.error('Post-cancellation side-effects failed:', error.message);
        }
      }, 100);

      res.json({
        success: true,
        message: 'Booking cancelled successfully'
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  });

  // Get user bookings
  getUserBookings = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const whereClause = { userId };
    if (status) whereClause.status = status;

    const bookings = await Booking.findAndCountAll({
      where: whereClause,
      include: [{ model: Event, as: 'event' }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (page - 1) * limit
    });

    res.json({
      success: true,
      data: {
        bookings: bookings.rows.map(booking => ({
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          status: booking.status,
          seatNumbers: booking.seatNumbers,
          totalAmount: booking.totalAmount,
          event: booking.event,
          hasQRCode: !!booking.qrCode
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: bookings.count,
          pages: Math.ceil(bookings.count / limit)
        }
      }
    });
  });

  // Helper method to check seat availability
  async checkSeatAvailability(eventId, seatNumbers, seatSection, seatRow) {
    try {
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
            if (seatNumbers.includes(seat)) {
              unavailable.push(seat);
            }
          });
        }
      });

      return unavailable;
    } catch (error) {
      logger.error('Seat availability check failed:', { error: error.message });
      return seatNumbers; // Assume all seats unavailable on error
    }
  }

  // Generate booking number
  generateBookingNumber() {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `BKG${timestamp.slice(-6)}${random}`;
  }

  // Generate seat map
  generateSeatMap(event, bookedSeats) {
    // Simulate venue seat map generation
    const sections = ['PREMIUM', 'GOLD', 'SILVER'];
    const rows = ['A', 'B', 'C', 'D', 'E'];
    const seatsPerRow = 10;

    const seatMap = {};

    sections.forEach(section => {
      seatMap[section] = {};
      rows.forEach(row => {
        seatMap[section][row] = [];
        for (let i = 1; i <= seatsPerRow; i++) {
          const seatNumber = `${row}${i}`;
          let status = 'available';

          // Check if seat is booked or selected
          bookedSeats.forEach(booking => {
            if (booking.seatSection === section && 
                booking.seatNumbers.includes(seatNumber)) {
              status = booking.status === 'CONFIRMED' ? 'booked' : 'selected';
            }
          });

          seatMap[section][row].push({
            seatNumber,
            status,
            price: this.getSeatPrice(section, event.price)
          });
        }
      });
    });

    return seatMap;
  }

  // Get seat price based on section
  getSeatPrice(section, basePrice) {
    const multipliers = {
      'PREMIUM': 1.5,
      'GOLD': 1.2,
      'SILVER': 1.0
    };
    return basePrice * (multipliers[section] || 1);
  }

  // Schedule expiry for bookings
  scheduleExpiry(bookingId, expiresAt) {
    const delay = expiresAt.getTime() - Date.now();

    // Don't schedule if already expired or delay is too long
    if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;

    setTimeout(async () => {
      try {
        const updated = await Booking.update(
          { status: 'EXPIRED' },
          {
            where: {
              id: bookingId,
              status: { [Op.in]: ['SEAT_SELECTED', 'RESERVED'] }
            }
          }
        );
        
        if (updated[0] > 0) {
          logger.info('Booking expired automatically:', { bookingId });
          
          // Broadcast seat release
          try {
            const expiredBooking = await Booking.findByPk(bookingId);
            if (expiredBooking && analyticsService && analyticsService.broadcastSeatActivity) {
              analyticsService.broadcastSeatActivity(expiredBooking.eventId, 'RELEASED', {
                seatNumbers: expiredBooking.seatNumbers,
                reason: 'EXPIRED'
              });
            }
          } catch (broadcastError) {
            logger.error('Failed to broadcast expiry:', broadcastError.message);
          }
        }
      } catch (error) {
        logger.error('Auto-expiry error:', { bookingId, error: error.message });
      }
    }, Math.max(0, delay));
  }
}

module.exports = new BookingController();