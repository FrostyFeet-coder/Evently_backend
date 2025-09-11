// src/controllers/ticketController.js
const { Booking, Event, User } = require('../models');
const logger = require('../utils/logger');
const { createError, asyncHandler } = require('../middleware/errorHandler');

class TicketController {
  // Validate QR ticket at venue entrance
  validateTicket = asyncHandler(async (req, res) => {
    const { ticketHash } = req.params;
    
    const booking = await Booking.findOne({
      where: { ticketHash },
      include: [
        { model: Event, as: 'event' },
        { model: User, as: 'user', attributes: ['name', 'email'] }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Invalid ticket',
        valid: false
      });
    }

    // Check if already validated
    if (booking.qrValidated) {
      return res.status(409).json({
        success: false,
        message: 'Ticket already used',
        valid: false,
        validatedAt: booking.qrValidatedAt
      });
    }

    // Validate ticket
    await booking.validateTicket();

    logger.info('Ticket validated', {
      bookingId: booking.id,
      eventId: booking.eventId,
      userId: booking.userId
    });

    res.json({
      success: true,
      message: 'Ticket validated successfully',
      valid: true,
      data: {
        bookingNumber: booking.bookingNumber,
        eventName: booking.event.name,
        userName: booking.user.name,
        seatNumbers: booking.seatNumbers,
        ticketCount: booking.ticketCount,
        validatedAt: booking.qrValidatedAt
      }
    });
  });

  // Get ticket details by booking ID
  getTicket = asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      where: { id: bookingId, userId, status: 'CONFIRMED' },
      include: [{ model: Event, as: 'event' }]
    });

    if (!booking) {
      throw createError.notFound('Ticket not found');
    }

    res.json({
      success: true,
      data: {
        ticketHash: booking.ticketHash,
        qrCode: booking.qrCode,
        bookingNumber: booking.bookingNumber,
        event: booking.event,
        seatNumbers: booking.seatNumbers,
        isValidated: booking.qrValidated
      }
    });
  });

  // Download ticket as PDF (future enhancement)
  downloadTicket = asyncHandler(async (req, res) => {
    // Implementation for PDF ticket download
    res.json({ message: 'PDF download feature coming soon' });
  });
}

module.exports = new TicketController();
