module.exports = (sequelize, DataTypes) => {
  const Booking = sequelize.define('Booking', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    bookingNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Events',
        key: 'id'
      }
    },
    ticketCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 10
      }
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: 'USD'
    },
    
    // ENHANCED BOOKING STATES
    status: {
      type: DataTypes.ENUM(
        'RESERVED',     // NEW: Temporarily reserved (15 min)
        'CONFIRMED',    // Payment completed, permanently booked
        'CANCELLED',    // User cancelled
        'EXPIRED',      // NEW: Reservation expired without payment
        'REFUNDED'      // Refund processed
      ),
      defaultValue: 'RESERVED'
    },
    
    bookingType: {
      type: DataTypes.ENUM('GENERAL', 'SEAT_SELECTION', 'VIP_PACKAGE'),
      defaultValue: 'GENERAL'
    },
    
    // RESERVATION TIMING (NEW)
    reservationExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '15-minute window to complete booking'
    },
    confirmedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expiredAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // PAYMENT DETAILS
    paymentStatus: {
      type: DataTypes.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'),
      defaultValue: 'PENDING'
    },
    paymentId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    paymentMethod: {
      type: DataTypes.ENUM('CARD', 'UPI', 'WALLET', 'NET_BANKING'),
      allowNull: true
    },
    paymentGateway: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // SEAT SELECTION DATA (for seat-level booking)
    seatDetails: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'JSON array of selected seat information'
    },
    
    // BOOKING METADATA
    bookingSource: {
      type: DataTypes.ENUM('WEB', 'MOBILE_APP', 'API'),
      defaultValue: 'WEB'
    },
    discountCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    discountAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    convenienceFee: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    taxAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    
    // CANCELLATION DETAILS
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    cancellationReason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    refundAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    refundProcessedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
    
  }, {
    tableName: 'Bookings',
    timestamps: true,
    indexes: [
      {
        fields: ['bookingNumber'],
        unique: true
      },
      {
        fields: ['userId']
      },
      {
        fields: ['eventId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['paymentStatus']
      },
      {
        fields: ['reservationExpiresAt']
      },
      {
        fields: ['createdAt']
      }
    ]
  });

  // INSTANCE METHODS
  Booking.prototype.isReservationActive = function() {
    if (this.status !== 'RESERVED') return false;
    if (!this.reservationExpiresAt) return false;
    
    return new Date() < new Date(this.reservationExpiresAt);
  };

  Booking.prototype.getTimeRemaining = function() {
    if (!this.reservationExpiresAt || this.status !== 'RESERVED') {
      return 0;
    }
    
    const remaining = new Date(this.reservationExpiresAt).getTime() - new Date().getTime();
    return Math.max(0, Math.floor(remaining / 1000)); // seconds remaining
  };

  Booking.prototype.formatTimeRemaining = function() {
    const seconds = this.getTimeRemaining();
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  Booking.prototype.canBeCancelled = function() {
    if (this.status === 'CANCELLED' || this.status === 'EXPIRED') {
      return false;
    }
    
    // Can cancel if confirmed and event is more than 24 hours away
    if (this.status === 'CONFIRMED') {
      const eventTime = this.Event?.dateTime;
      if (eventTime) {
        const hoursUntilEvent = (new Date(eventTime).getTime() - new Date().getTime()) / (1000 * 60 * 60);
        return hoursUntilEvent > 24; // 24-hour cancellation policy
      }
    }
    
    // Can cancel reserved bookings anytime
    return this.status === 'RESERVED';
  };

  Booking.prototype.calculateRefundAmount = function() {
    if (!this.canBeCancelled()) return 0;
    
    const baseRefund = parseFloat(this.totalAmount);
    
    // Apply cancellation fee based on timing
    if (this.Event?.dateTime) {
      const hoursUntilEvent = (new Date(this.Event.dateTime).getTime() - new Date().getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilEvent > 168) { // 7 days
        return baseRefund; // Full refund
      } else if (hoursUntilEvent > 24) { // 1-7 days
        return baseRefund * 0.8; // 80% refund
      }
    }
    
    return baseRefund * 0.5; // 50% refund for last-minute cancellations
  };

  // CLASS METHODS
  Booking.findActiveReservation = async function(userId, eventId, transaction) {
    return await Booking.findOne({
      where: {
        userId,
        eventId,
        status: 'RESERVED',
        reservationExpiresAt: {
          [sequelize.Sequelize.Op.gt]: new Date()
        }
      },
      transaction
    });
  };

  Booking.cleanupExpiredReservations = async function(transaction) {
    const now = new Date();
    
    // Find expired reservations
    const expiredBookings = await Booking.findAll({
      where: {
        status: 'RESERVED',
        reservationExpiresAt: {
          [sequelize.Sequelize.Op.lt]: now
        }
      },
      transaction
    });

    // Mark as expired
    await Booking.update({
      status: 'EXPIRED',
      expiredAt: now
    }, {
      where: {
        status: 'RESERVED',
        reservationExpiresAt: {
          [sequelize.Sequelize.Op.lt]: now
        }
      },
      transaction
    });

    return expiredBookings;
  };

  Booking.getBookingStats = async function(eventId, dateRange) {
    const whereClause = {};
    if (eventId) whereClause.eventId = eventId;
    if (dateRange) {
      whereClause.createdAt = {
        [sequelize.Sequelize.Op.between]: [dateRange.start, dateRange.end]
      };
    }

    const stats = await Booking.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', '*'), 'count'],
        [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalRevenue'],
        [sequelize.fn('SUM', sequelize.col('ticketCount')), 'totalTickets']
      ],
      where: whereClause,
      group: ['status']
    });

    return stats.reduce((acc, stat) => {
      acc[stat.status] = {
        count: parseInt(stat.get('count')),
        totalRevenue: parseFloat(stat.get('totalRevenue') || 0),
        totalTickets: parseInt(stat.get('totalTickets') || 0)
      };
      return acc;
    }, {});
  };

  return Booking;
};