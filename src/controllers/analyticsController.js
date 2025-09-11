const { User, Event, Booking } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');

const getDashboardStats = async (req, res, next) => {
  try {
    // Only admins can access analytics
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    console.log(' Getting dashboard stats...');

    const [
      totalUsers,
      totalEvents,
      totalBookings,
      totalRevenue,
      activeEvents,
      recentBookings
    ] = await Promise.all([
      User.count(),
      Event.count(),
      Booking.count(),
      Booking.sum('totalAmount', { where: { status: ['CONFIRMED', 'PAYMENT_PENDING'] } }),
      Event.count({ where: { status: 'PUBLISHED' } }),
      Booking.count({ where: { createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    ]);

    console.log(' Basic stats collected:', { totalUsers, totalEvents, totalBookings });

    // Get popular events with a simpler approach
    const popularEvents = await sequelize.query(`
      SELECT 
        e.id,
        e.name,
        e.venue,
        e."dateTime",
        COUNT(b.id) as "bookingCount"
      FROM "Events" e
      LEFT JOIN "bookings" b ON e.id = b."eventId" 
      WHERE e.status = 'PUBLISHED'
      GROUP BY e.id, e.name, e.venue, e."dateTime"
      ORDER BY COUNT(b.id) DESC
      LIMIT 5
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    console.log(' Popular events:', popularEvents.length);

    // Get recent events
    const recentEvents = await Event.findAll({
      where: { status: 'PUBLISHED' },
      order: [['createdAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'name', 'venue', 'dateTime', 'capacity', 'availableSeats']
    });

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers: totalUsers || 0,
          totalEvents: totalEvents || 0,
          totalBookings: totalBookings || 0,
          totalRevenue: parseFloat(totalRevenue || 0),
          activeEvents: activeEvents || 0,
          recentBookings: recentBookings || 0
        },
        popularEvents: popularEvents || [],
        recentEvents: recentEvents || []
      }
    });

  } catch (error) {
    console.error(' Dashboard stats error:', error);
    logger.error('Dashboard stats error:', error);
    next(error);
  }
};

const getBookingTrends = async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    const { startDate, endDate } = req.query;

    console.log(' Getting booking trends:', { startDate, endDate });

    let dateFilter = '';
    const replacements = {};

    if (startDate && endDate) {
      dateFilter = 'WHERE b."createdAt" BETWEEN :startDate AND :endDate';
      replacements.startDate = startDate;
      replacements.endDate = endDate;
    } else if (startDate) {
      dateFilter = 'WHERE b."createdAt" >= :startDate';
      replacements.startDate = startDate;
    } else if (endDate) {
      dateFilter = 'WHERE b."createdAt" <= :endDate';
      replacements.endDate = endDate;
    }

    const trends = await sequelize.query(`
      SELECT 
        DATE(b."createdAt") as date,
        COUNT(b.id)::integer as bookings,
        COALESCE(SUM(b."totalAmount"), 0)::float as revenue
      FROM "bookings" b
      ${dateFilter}
      GROUP BY DATE(b."createdAt")
      ORDER BY DATE(b."createdAt") ASC
      LIMIT 30
    `, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    // Get booking status distribution
    const statusDistribution = await sequelize.query(`
      SELECT 
        status,
        COUNT(*)::integer as count
      FROM "bookings"
      ${dateFilter ? dateFilter.replace('WHERE', 'WHERE') : ''}
      GROUP BY status
    `, {
      replacements,
      type: sequelize.QueryTypes.SELECT
    });

    console.log(' Trends collected:', trends.length, 'days');

    res.json({
      success: true,
      data: {
        trends: trends || [],
        statusDistribution: statusDistribution || [],
        summary: {
          totalDays: trends.length,
          totalBookings: trends.reduce((sum, day) => sum + day.bookings, 0),
          totalRevenue: trends.reduce((sum, day) => sum + parseFloat(day.revenue || 0), 0)
        }
      }
    });

  } catch (error) {
    console.error(' Booking trends error:', error);
    logger.error('Booking trends error:', error);
    next(error);
  }
};

// Event analytics
const getEventAnalytics = async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    // Get events with booking stats
    const eventStats = await sequelize.query(`
      SELECT 
        e.id,
        e.name,
        e.venue,
        e."dateTime",
        e.capacity,
        e."availableSeats",
        e.price,
        e.status,
        COUNT(b.id)::integer as "totalBookings",
        COALESCE(SUM(b."totalAmount"), 0)::float as revenue,
            (COUNT(b.id)::float / e.capacity * 100) as "utilizationPercent"
      FROM "Events" e
      LEFT JOIN"bookings" b ON e.id = b."eventId" AND b.status IN ('PAYMENT_PENDING', 'CONFIRMED')
      GROUP BY e.id, e.name, e.venue, e."dateTime", e.capacity, e."availableSeats", e.price, e.status
      ORDER BY "totalBookings" DESC
      LIMIT 20
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data: {
        events: eventStats || []
      }
    });

  } catch (error) {
    console.error(' Event analytics error:', error);
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getBookingTrends,
  getEventAnalytics
};
