// src/services/analyticsService.js - Fixed version
const { Event, Booking, User } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');

class AnalyticsService {
  constructor() {
    this.clients = new Set();
    this.broadcastInterval = null;
    this.startBroadcasting();
  }

  // Start broadcasting live stats every 10 seconds
  startBroadcasting() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }

    this.broadcastInterval = setInterval(async () => {
      try {
        await this.broadcastLiveStats();
      } catch (error) {
        logger.error('Analytics broadcast error:', error);
      }
    }, 10000); // 10 seconds
  }

  async broadcastLiveStats() {
    try {
      const stats = await this.getCurrentStats();
      this.broadcast('LIVE_STATS', stats);
    } catch (error) {
      logger.error('Failed to broadcast live stats:', error);
    }
  }

  async getCurrentStats() {
    try {
      const [
        totalBookings,
        totalRevenue,
        activeUsers,
        popularEvents
      ] = await Promise.all([
        this.getTotalBookings(),
        this.getTotalRevenue(),
        this.getActiveUsers(),
        this.getPopularEvents()
      ]);

      return {
        timestamp: new Date(),
        totalBookings,
        totalRevenue,
        activeUsers,
        popularEvents
      };
    } catch (error) {
      logger.error('Error getting current stats:', error);
      return {
        timestamp: new Date(),
        totalBookings: 0,
        totalRevenue: 0,
        activeUsers: 0,
        popularEvents: []
      };
    }
  }

  async getTotalBookings() {
    try {
      return await Booking.count({
        where: {
          status: 'CONFIRMED'
        }
      });
    } catch (error) {
      logger.error('Error getting total bookings:', error);
      return 0;
    }
  }

  async getTotalRevenue() {
    try {
      const result = await Booking.sum('totalAmount', {
        where: {
          status: 'CONFIRMED'
        }
      });
      return result || 0;
    } catch (error) {
      logger.error('Error getting total revenue:', error);
      return 0;
    }
  }

  async getPopularEvents() {
  try {
    const popularEvents = await sequelize.query(`
      SELECT 
        e.id,
        e.name,
        e."dateTime",
        e.venue,
        e.category,
        COUNT(b.id) AS "bookingCount",
        COALESCE(SUM(b."totalAmount"), 0) AS "totalRevenue"
      FROM "Events" e
      LEFT JOIN "bookings" b 
        ON e.id = b."eventId" AND b.status = 'CONFIRMED'
      GROUP BY e.id
      ORDER BY "bookingCount" DESC
      LIMIT 5
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    return popularEvents.map(event => ({
      id: event.id,
      name: event.name,
      dateTime: event.dateTime,
      venue: event.venue,
      category: event.category,
      bookingCount: parseInt(event.bookingCount || 0),
      totalRevenue: parseFloat(event.totalRevenue || 0)
    }));
  } catch (error) {
    console.error('Error getting popular events:', error);
    return [];
  }
}


  async getActiveUsers() {
  try {
    const activeUsersCount = await User.count({
      where: {
        isActive: true,
        updatedAt: {
          [Op.gte]: new Date(new Date() - 24 * 60 * 60 * 1000) // last 24h
        }
      }
    });
    return activeUsersCount;
  } catch (error) {
    logger.error('Error getting active users:', error);
    return 0;
  }
}

  // Fixed version of getPopularEvents
  // Alternative simpler version if the above still has issues
  async getPopularEventsSimple() {
    try {
      const results = await sequelize.query(`
        SELECT 
          e.id,
          e.name,
          e.date,
          e.venue,
          e.city,
          COUNT(b.id) as "bookingCount",
          SUM(b."totalAmount") as "totalRevenue"
        FROM "Events" e
        INNER JOIN "bookings" b ON e.id = b."eventId"
        WHERE b.status = 'CONFIRMED'
        GROUP BY e.id, e.name, e.date, e.venue, e.city
        ORDER BY COUNT(b.id) DESC
        LIMIT 5
      `, {
        type: sequelize.QueryTypes.SELECT
      });

      return results.map(event => ({
        id: event.id,
        name: event.name,
        date: event.date,
        venue: event.venue,
        city: event.city,
        bookingCount: parseInt(event.bookingCount || 0),
        totalRevenue: parseFloat(event.totalRevenue || 0)
      }));
    } catch (error) {
      logger.error('Error getting popular events (simple):', error);
      return [];
    }
  }

  // Broadcast seat activity in real-time
  broadcastSeatActivity(eventId, action, data) {
    try {
      const payload = {
        eventId,
        action, // 'SELECTED', 'BOOKED', 'RELEASED'
        timestamp: new Date(),
        ...data
      };

      this.broadcast('SEAT_ACTIVITY', payload);
      logger.info('Seat activity broadcasted:', payload);
    } catch (error) {
      logger.error('Error broadcasting seat activity:', error);
    }
  }

  // Get event-specific analytics
  async getEventAnalytics(eventId) {
    try {
      const [
        totalBookings,
        totalRevenue,
        seatsSold,
        recentBookings
      ] = await Promise.all([
        Booking.count({
          where: { eventId, status: 'CONFIRMED' }
        }),
        Booking.sum('totalAmount', {
          where: { eventId, status: 'CONFIRMED' }
        }),
        this.getSeatsSoldCount(eventId),
        this.getRecentBookings(eventId)
      ]);

      return {
        eventId,
        totalBookings,
        totalRevenue: totalRevenue || 0,
        seatsSold,
        recentBookings
      };
    } catch (error) {
      logger.error('Error getting event analytics:', error);
      return {
        eventId,
        totalBookings: 0,
        totalRevenue: 0,
        seatsSold: 0,
        recentBookings: []
      };
    }
  }

  async getSeatsSoldCount(eventId) {
    try {
      const bookings = await Booking.findAll({
        where: { eventId, status: 'CONFIRMED' },
        attributes: ['seatNumbers']
      });

      let totalSeats = 0;
      bookings.forEach(booking => {
        if (booking.seatNumbers && Array.isArray(booking.seatNumbers)) {
          totalSeats += booking.seatNumbers.length;
        }
      });

      return totalSeats;
    } catch (error) {
      logger.error('Error getting seats sold count:', error);
      return 0;
    }
  }

  async getRecentBookings(eventId, limit = 10) {
    try {
      return await Booking.findAll({
        where: { eventId, status: 'CONFIRMED' },
        include: [{
          model: User,
          as: 'user',
          attributes: ['firstName', 'lastName']
        }],
        order: [['createdAt', 'DESC']],
        limit,
        attributes: ['id', 'bookingNumber', 'seatNumbers', 'totalAmount', 'createdAt']
      });
    } catch (error) {
      logger.error('Error getting recent bookings:', error);
      return [];
    }
  }

  // Revenue analytics
  async getRevenueAnalytics(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const dailyRevenue = await sequelize.query(`
        SELECT 
          DATE(b."createdAt") as date,
          SUM(b."totalAmount") as revenue,
          COUNT(b.id) as bookings
        FROM "bookings" b
        WHERE b.status = 'CONFIRMED' 
          AND b."createdAt" >= :startDate
        GROUP BY DATE(b."createdAt")
        ORDER BY DATE(b."createdAt")
      `, {
        replacements: { startDate },
        type: sequelize.QueryTypes.SELECT
      });

      return dailyRevenue.map(day => ({
        date: day.date,
        revenue: parseFloat(day.revenue || 0),
        bookings: parseInt(day.bookings || 0)
      }));
    } catch (error) {
      logger.error('Error getting revenue analytics:', error);
      return [];
    }
  }

  // Generic broadcast method
  broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    
    this.clients.forEach(client => {
      try {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(message);
        }
      } catch (error) {
        logger.error('Error sending message to client:', error);
        this.clients.delete(client);
      }
    });
  }

  // WebSocket client management
  addClient(ws) {
    this.clients.add(ws);
    logger.info('Analytics client connected. Total clients:', this.clients.size);

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.info('Analytics client disconnected. Total clients:', this.clients.size);
    });

    ws.on('error', (error) => {
      logger.error('WebSocket client error:', error);
      this.clients.delete(ws);
    });

    // Send initial stats to new client
    this.getCurrentStats().then(stats => {
      try {
        ws.send(JSON.stringify({ type: 'INITIAL_STATS', data: stats }));
      } catch (error) {
        logger.error('Error sending initial stats:', error);
      }
    });
  }

  // Cleanup
  destroy() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
    this.clients.clear();
  }

  // Booking status change analytics
  async trackBookingStatusChange(bookingId, oldStatus, newStatus) {
    try {
      logger.info('Booking status change tracked:', {
        bookingId,
        oldStatus,
        newStatus,
        timestamp: new Date()
      });

      // Broadcast status change if it's significant
      if (newStatus === 'CONFIRMED' || newStatus === 'CANCELLED') {
        const booking = await Booking.findByPk(bookingId, {
          include: [{ model: Event, as: 'event' }]
        });

        if (booking) {
          this.broadcast('BOOKING_STATUS_CHANGE', {
            bookingId,
            oldStatus,
            newStatus,
            eventId: booking.eventId,
            eventName: booking.event?.name,
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      logger.error('Error tracking booking status change:', error);
    }
  }
}

module.exports = new AnalyticsService();