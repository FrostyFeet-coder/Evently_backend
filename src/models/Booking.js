// src/models/Booking.js
const { DataTypes } = require('sequelize');
const QRCode = require('qrcode');
const crypto = require('crypto');

module.exports = (sequelize) => {
  const Booking = sequelize.define('Booking', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    bookingNumber: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    
    // BookMyShow-style seat booking fields
    seatNumbers: {
      type: DataTypes.JSON, // Array of seat numbers: ["A1", "A2", "A3"]
      allowNull: true
    },
    seatSection: {
      type: DataTypes.STRING, // "PREMIUM", "GOLD", "SILVER"
      allowNull: true
    },
    seatRow: {
      type: DataTypes.STRING, // "A", "B", "C"
      allowNull: true  
    },
    
    // Booking details
    ticketCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    bookingType: {
      type: DataTypes.ENUM('GENERAL_ADMISSION', 'SEAT_SELECTION'),
      defaultValue: 'GENERAL_ADMISSION'
    },
    
    // Pricing
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.0

    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    currency: {
      type: DataTypes.STRING,
      defaultValue: 'USD'
    },
    
    // Booking status flow (BookMyShow style)
    status: {
      type: DataTypes.ENUM(
        'SEAT_SELECTED',    // Step 1: Seats selected, 15min timer starts
        'RESERVED',         // Step 2: Reserved, awaiting payment
        'PAYMENT_PENDING',  // Step 3: Payment initiated
        'CONFIRMED',        // Step 4: Payment successful
        'CANCELLED',        // Cancelled by user/system
        'EXPIRED'          // Reservation expired
      ),
      defaultValue: 'SEAT_SELECTED'
    },
    
    // Timer management
    reservationExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    isExpired: {
      type: DataTypes.VIRTUAL,
      get() {
        if (!this.reservationExpiresAt) return false;
        return new Date() > this.reservationExpiresAt;
      }
    },
    timeRemaining: {
      type: DataTypes.VIRTUAL,
      get() {
        if (!this.reservationExpiresAt) return 0;
        const remaining = this.reservationExpiresAt.getTime() - Date.now();
        return Math.max(0, Math.floor(remaining / 1000)); // seconds
      }
    },
    
    // Payment fields
    paymentStatus: {
      type: DataTypes.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'),
      defaultValue: 'PENDING'
    },
    paymentId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    paymentMethod: {
      type: DataTypes.STRING,
      allowNull: true
    },
    paymentGateway: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // QR Ticket fields
    qrCode: {
      type: DataTypes.TEXT, // Base64 QR code image
      allowNull: true
    },
    ticketHash: {
      type: DataTypes.STRING, // Unique hash for validation
      allowNull: true
    },
    qrValidated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    qrValidatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // Notification tracking
    emailSent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    smsNotificationSent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    // Metadata
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'bookings',
    timestamps: true,
    hooks: {
      // Generate QR ticket after confirmation
      afterUpdate: async (booking, options) => {
        if (booking.status === 'CONFIRMED' && !booking.qrCode) {
          await booking.generateQRTicket();
        }
      }
    }
  });

  // Instance methods
  Booking.prototype.generateQRTicket = async function() {
    try {
      // Create unique ticket hash
      const ticketData = {
        bookingId: this.id,
        bookingNumber: this.bookingNumber,
        eventId: this.eventId,
        userId: this.userId,
        seatNumbers: this.seatNumbers,
        timestamp: Date.now()
      };
      
      this.ticketHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(ticketData))
        .digest('hex');
      
      // Generate QR code
      const qrData = {
        hash: this.ticketHash,
        booking: this.bookingNumber,
        event: this.eventId,
        seats: this.seatNumbers,
        validation: `${process.env.BASE_URL}/api/tickets/validate/${this.ticketHash}`
      };
      
      this.qrCode = await QRCode.toDataURL(JSON.stringify(qrData), {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      await this.save();
      return this.qrCode;
    } catch (error) {
      console.error('QR generation error:', error);
      throw error;
    }
  };

  Booking.prototype.validateTicket = function() {
    if (this.status !== 'CONFIRMED') return false;
    if (this.qrValidated) return false; // Already used
    
    this.qrValidated = true;
    this.qrValidatedAt = new Date();
    return this.save();
  };

  Booking.prototype.getTimeRemainingFormatted = function() {
    const seconds = this.timeRemaining;
    if (seconds <= 0) return 'Expired';
    
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Associations
  Booking.associate = function(models) {
    Booking.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Booking.belongsTo(models.Event, { foreignKey: 'eventId', as: 'event' });
  };

  return Booking;
};
