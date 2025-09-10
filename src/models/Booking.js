const bcrypt = require('bcryptjs');

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
      unique: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    ticketCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 10 }
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'USD'
    },
    status: {
      type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'),
      defaultValue: 'PENDING'
    },
    paymentStatus: {
      type: DataTypes.ENUM('PENDING', 'COMPLETED', 'FAILED'),
      defaultValue: 'PENDING'
    },
    bookingTime: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    confirmedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancelledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancellationReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  }, {
    tableName: 'bookings',
    timestamps: true,
    
    hooks: {
      beforeCreate: (booking, options) => {
        console.log(' beforeCreate hook triggered for booking');
        
        // Generate booking number if not provided
        if (!booking.bookingNumber) {
          const timestamp = Date.now().toString().slice(-8);
          const random = Math.random().toString(36).substring(2, 6).toUpperCase();
          booking.bookingNumber = `EVT-${timestamp}-${random}`;
          console.log(' Generated booking number:', booking.bookingNumber);
        }
        
        // Set expiration time if not provided
        if (!booking.expiresAt) {
          const expiryMinutes = parseInt(process.env.BOOKING_EXPIRY_MINUTES) || 15;
          booking.expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
          console.log(' Set expiration time:', booking.expiresAt);
        }
      }
    }
  });

  // Instance method to check if booking is expired
  Booking.prototype.isExpired = function() {
    return this.status === 'PENDING' && new Date() > new Date(this.expiresAt);
  };

  return Booking;
};
