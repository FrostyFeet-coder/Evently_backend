// src/controllers/seatController.js
const { Seat, Event, Booking, User } = require('../models');
const { sequelize } = require('../config/database');
const { lock } = require('../config/redis');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

const generateSeatMap = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { regenerate = false } = req.query;

    console.log('Generating seat map for event:', eventId);

    const event = await Event.findByPk(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const existingSeats = await Seat.count({ where: { eventId } });
    
    if (existingSeats > 0 && !regenerate) {
      return res.status(409).json({
        success: false,
        message: 'Seat map already exists. Use regenerate=true to recreate.',
        existingSeats
      });
    }

    if (regenerate && existingSeats > 0) {
      await Seat.destroy({ where: { eventId } });
      console.log('Deleted existing seats for regeneration');
    }

    const transaction = await sequelize.transaction();

    try {
      const seats = [];
      
      const venueLayout = {
        VIP: { rows: ['A', 'B'], seatsPerRow: 10, priceMultiplier: 2.0 },
        PREMIUM: { rows: ['C', 'D', 'E'], seatsPerRow: 15, priceMultiplier: 1.5 },
        GENERAL: { rows: ['F', 'G', 'H', 'I', 'J'], seatsPerRow: 20, priceMultiplier: 1.0 }
      };

      for (const [section, config] of Object.entries(venueLayout)) {
        for (const row of config.rows) {
          for (let seatNum = 1; seatNum <= config.seatsPerRow; seatNum++) {
            const seatNumber = `${row}${seatNum}`;
            const price = parseFloat(event.price) * config.priceMultiplier;
            
            let seatType = 'REGULAR';
            if (seatNum === 1 || seatNum === config.seatsPerRow) {
              seatType = 'AISLE';
            }
            if (section === 'VIP' && (seatNum >= 5 && seatNum <= 6)) {
              seatType = 'PREMIUM';
            }
            if (row === 'A' && (seatNum === 1 || seatNum === 2)) {
              seatType = 'WHEELCHAIR_ACCESSIBLE';
            }

            seats.push({
              eventId,
              seatNumber,
              row,
              section,
              price,
              seatType,
              isBooked: false,
              isBlocked: false
            });
          }
        }
      }

      await Seat.bulkCreate(seats, { transaction });
      await transaction.commit();

      console.log(`Generated ${seats.length} seats for event ${eventId}`);

      res.status(201).json({
        success: true,
        message: 'Seat map generated successfully',
        data: {
          eventId,
          totalSeats: seats.length,
          sections: Object.keys(venueLayout),
          layout: venueLayout
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Generate seat map error:', error);
    next(error);
  }
};

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

    const seats = await Seat.findAll({
      where: { eventId },
      order: [['section', 'ASC'], ['row', 'ASC'], ['seatNumber', 'ASC']],
      attributes: [
        'id', 'seatNumber', 'row', 'section', 'price', 
        'isBooked', 'isBlocked', 'seatType', 'bookedAt'
      ]
    });

    if (seats.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No seat map found for this event. Generate one first.',
        generateUrl: `/api/seats/${eventId}/generate`
      });
    }

    const seatMap = {};
    const stats = { total: seats.length, available: 0, booked: 0, blocked: 0 };

    seats.forEach(seat => {
      if (!seatMap[seat.section]) seatMap[seat.section] = {};
      if (!seatMap[seat.section][seat.row]) seatMap[seat.section][seat.row] = [];

      seatMap[seat.section][seat.row].push({
        id: seat.id,
        seatNumber: seat.seatNumber,
        price: parseFloat(seat.price),
        isBooked: seat.isBooked,
        isBlocked: seat.isBlocked,
        seatType: seat.seatType,
        bookedAt: seat.bookedAt
      });

      if (seat.isBooked) stats.booked++;
      else if (seat.isBlocked) stats.blocked++;
      else stats.available++;
    });

    res.json({
      success: true,
      data: {
        eventId,
        eventName: event.name,
        eventDate: event.dateTime,
        seatMap,
        stats
      }
    });

  } catch (error) {
    console.error(' Get seat map error:', error);
    next(error);
  }
};

const bookSpecificSeats = async (req, res, next) => {
  try {
    const { eventId, selectedSeatIds } = req.body;
    const userId = req.user.id;

    console.log('Booking specific seats:', { userId, eventId, selectedSeatIds });

    if (!selectedSeatIds || !Array.isArray(selectedSeatIds) || selectedSeatIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected seat IDs are required'
      });
    }

    const event = await Event.findByPk(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const lockResource = `seats:${eventId}`;
    const lockInfo = await lock.acquire(lockResource, 30000);
    
    if (!lockInfo) {
      return res.status(500).json({
        success: false,
        message: 'Unable to process seat booking. Please try again.'
      });
    }

    const transaction = await sequelize.transaction();

    try {
      const selectedSeats = await Seat.findAll({
        where: { 
          id: { [Op.in]: selectedSeatIds },
          eventId 
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (selectedSeats.length !== selectedSeatIds.length) {
        await transaction.rollback();
        await lock.release(lockInfo.key, lockInfo.value);
        
        return res.status(404).json({
          success: false,
          message: 'Some selected seats not found'
        });
      }

      const unavailableSeats = selectedSeats.filter(seat => seat.isBooked || seat.isBlocked);
      if (unavailableSeats.length > 0) {
        await transaction.rollback();
        await lock.release(lockInfo.key, lockInfo.value);

        return res.status(409).json({
          success: false,
          message: 'Some selected seats are no longer available',
          unavailableSeats: unavailableSeats.map(seat => ({
            id: seat.id,
            seatNumber: seat.seatNumber,
            status: seat.isBooked ? 'booked' : 'blocked'
          }))
        });
      }

      const totalAmount = selectedSeats.reduce((sum, seat) => sum + parseFloat(seat.price), 0);
      
      const booking = await Booking.create({
        userId,
        eventId,
        ticketCount: selectedSeats.length,
        totalAmount,
        currency: 'USD',
        bookingType: 'SEAT_SELECTION',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      }, { transaction });

      await Seat.update({
        isBooked: true,
        bookedBy: userId,
        bookingId: booking.id,
        bookedAt: new Date()
      }, {
        where: { id: { [Op.in]: selectedSeatIds } },
        transaction
      });

      await event.update({
        availableSeats: event.availableSeats - selectedSeats.length
      }, { transaction });

      await transaction.commit();
      await lock.release(lockInfo.key, lockInfo.value);

      console.log('Seats booked successfully:', booking.bookingNumber);

      res.status(201).json({
        success: true,
        message: 'Seats booked successfully',
        data: {
          booking: {
            id: booking.id,
            bookingNumber: booking.bookingNumber,
            totalAmount: parseFloat(booking.totalAmount),
            ticketCount: booking.ticketCount,
            status: booking.status,
            expiresAt: booking.expiresAt
          },
          bookedSeats: selectedSeats.map(seat => ({
            id: seat.id,
            seatNumber: seat.seatNumber,
            section: seat.section,
            row: seat.row,
            price: parseFloat(seat.price)
          }))
        }
      });

    } catch (error) {
      await transaction.rollback();
      await lock.release(lockInfo.key, lockInfo.value);
      throw error;
    }

  } catch (error) {
    console.error(' Book specific seats error:', error);
    next(error);
  }
};

const getAvailableSeats = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { section, priceRange, seatType } = req.query;

    let whereClause = {
      eventId,
      isBooked: false,
      isBlocked: false
    };

    if (section) whereClause.section = section;
    if (seatType) whereClause.seatType = seatType;
    if (priceRange) {
      const [minPrice, maxPrice] = priceRange.split('-').map(Number);
      whereClause.price = { [Op.between]: [minPrice, maxPrice] };
    }

    const availableSeats = await Seat.findAll({
      where: whereClause,
      order: [['section', 'ASC'], ['row', 'ASC'], ['seatNumber', 'ASC']],
      attributes: ['id', 'seatNumber', 'row', 'section', 'price', 'seatType']
    });

    res.json({
      success: true,
      data: {
        eventId,
        availableSeats,
        count: availableSeats.length
      }
    });

  } catch (error) {
    console.error('Get available seats error:', error);
    next(error);
  }
};

module.exports = {
  generateSeatMap,
  getSeatMap,
  bookSpecificSeats,
  getAvailableSeats
};