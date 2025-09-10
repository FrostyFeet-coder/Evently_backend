// src/models/Seat.js - ENHANCED WITH CONCURRENCY CONTROLS
module.exports = (sequelize, DataTypes) => {
  const Seat = sequelize.define('Seat', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Events',
        key: 'id'
      }
    },
    seatNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    row: {
      type: DataTypes.STRING,
      allowNull: false
    },
    section: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'GENERAL'
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    
    // BOOKING STATUS FIELDS
    isBooked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    isReserved: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    isBlocked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    // BOOKING DETAILS
    bookedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    bookingId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'Bookings',
        key: 'id'
      }
    },
    bookedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // RESERVATION DETAILS (NEW - for temporary holds)
    reservedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    reservedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    reserveExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // SEAT ATTRIBUTES
    seatType: {
      type: DataTypes.ENUM('REGULAR', 'WHEELCHAIR_ACCESSIBLE', 'AISLE', 'PREMIUM', 'VIP'),
      defaultValue: 'REGULAR'
    },
    
    // CONCURRENCY CONTROL (NEW)
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Optimistic locking version'
    },
    lockExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Pessimistic lock expiration'
    },
    lockedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Session ID that has the lock'
    }
    
  }, {
    tableName: 'seats',
    timestamps: true,
    indexes: [
      {
        fields: ['eventId']
      },
      {
        fields: ['eventId', 'seatNumber'],
        unique: true,
        name: 'seats_event_seat_unique'
      },
      {
        fields: ['section', 'row']
      },
      {
        fields: ['isBooked', 'isReserved', 'isBlocked']
      },
      {
        fields: ['reservedBy', 'reserveExpiresAt']
      },
      {
        fields: ['version'] // For optimistic locking
      }
    ]
  });

  // INSTANCE METHODS
  Seat.prototype.isAvailable = function() {
    const now = new Date();
    
    // Not available if booked or blocked
    if (this.isBooked || this.isBlocked) {
      return false;
    }
    
    // Not available if currently reserved and not expired
    if (this.isReserved && this.reserveExpiresAt && now < new Date(this.reserveExpiresAt)) {
      return false;
    }
    
    return true;
  };

  Seat.prototype.canBeReservedBy = function(userId) {
    const now = new Date();
    
    // Available for reservation
    if (this.isAvailable()) {
      return true;
    }
    
    // Already reserved by this user
    if (this.isReserved && this.reservedBy === userId) {
      return true;
    }
    
    return false;
  };

  Seat.prototype.getStatus = function() {
    const now = new Date();
    
    if (this.isBlocked) return 'BLOCKED';
    if (this.isBooked) return 'BOOKED';
    
    if (this.isReserved) {
      if (this.reserveExpiresAt && now < new Date(this.reserveExpiresAt)) {
        return 'RESERVED';
      } else {
        return 'EXPIRED_RESERVATION'; // Should be cleaned up
      }
    }
    
    return 'AVAILABLE';
  };

  // CLASS METHODS
  Seat.reserveSeats = async function(eventId, seatIds, userId, transaction) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

    // Use SELECT FOR UPDATE to prevent race conditions
    const seats = await Seat.findAll({
      where: {
        id: { [sequelize.Sequelize.Op.in]: seatIds },
        eventId,
        isBooked: false,
        isBlocked: false,
        [sequelize.Sequelize.Op.or]: [
          { isReserved: false },
          { 
            isReserved: true,
            reserveExpiresAt: { [sequelize.Sequelize.Op.lt]: now }
          },
          {
            isReserved: true,
            reservedBy: userId
          }
        ]
      },
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (seats.length !== seatIds.length) {
      throw new Error('Some seats are not available for reservation');
    }

    // Update seats to reserved status
    await Seat.update({
      isReserved: true,
      reservedBy: userId,
      reservedAt: now,
      reserveExpiresAt: expiresAt,
      version: sequelize.literal('version + 1')
    }, {
      where: {
        id: { [sequelize.Sequelize.Op.in]: seatIds }
      },
      transaction
    });

    return seats;
  };

  Seat.confirmReservation = async function(bookingId, userId, transaction) {
    const updated = await Seat.update({
      isBooked: true,
      isReserved: false,
      bookingId,
      bookedBy: userId,
      bookedAt: new Date(),
      reservedBy: null,
      reservedAt: null,
      reserveExpiresAt: null,
      version: sequelize.literal('version + 1')
    }, {
      where: {
        reservedBy: userId,
        bookingId: null,
        isReserved: true
      },
      transaction
    });

    return updated[0]; // Number of affected rows
  };

  Seat.releaseReservation = async function(userId, bookingId = null, transaction) {
    const whereClause = {
      reservedBy: userId,
      isReserved: true,
      isBooked: false
    };

    if (bookingId) {
      whereClause.bookingId = bookingId;
    }

    const updated = await Seat.update({
      isReserved: false,
      reservedBy: null,
      reservedAt: null,
      reserveExpiresAt: null,
      version: sequelize.literal('version + 1')
    }, {
      where: whereClause,
      transaction
    });

    return updated[0]; // Number of affected rows
  };

  Seat.cleanupExpiredReservations = async function(transaction) {
    const now = new Date();
    
    const updated = await Seat.update({
      isReserved: false,
      reservedBy: null,
      reservedAt: null,
      reserveExpiresAt: null,
      version: sequelize.literal('version + 1')
    }, {
      where: {
        isReserved: true,
        reserveExpiresAt: { [sequelize.Sequelize.Op.lt]: now },
        isBooked: false
      },
      transaction
    });

    return updated[0]; // Number of cleaned up seats
  };

  return Seat;
};