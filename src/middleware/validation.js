const Joi = require('joi');
const { AppError } = require('./errorHandler');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      const message = error.details.map(detail => detail.message).join(', ');
      throw new AppError(message, 400);
    }
    
    next();
  };
};

const schemas = {
  register: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    phone: Joi.string().min(10).max(15).optional()
  }),

  adminRegister: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    phone: Joi.string().min(10).max(15).optional(),
    adminCode: Joi.string().optional() // Optional admin verification code
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).required()
  }),

  updateProfile: Joi.object({
    name: Joi.string().min(2).max(100).optional(),
    phone: Joi.string().min(10).max(15).optional()
  }),

  createEvent: Joi.object({
    name: Joi.string().min(3).max(200).required(),
    description: Joi.string().max(2000).optional(),
    venue: Joi.string().min(3).max(200).required(),
    dateTime: Joi.date().required(),
    capacity: Joi.number().min(1).max(100000).required(),
    price: Joi.number().min(0).required(),
    category: Joi.string().valid('CONCERT', 'CONFERENCE', 'WORKSHOP', 'SPORTS', 'THEATER', 'OTHER').optional(),
    imageUrl: Joi.string().uri().optional()
  }),

  createBooking: Joi.object({
    eventId: Joi.string().uuid().required(),
    ticketCount: Joi.number().min(1).max(10).required()
  })

  
};

module.exports = { validate, schemas };

// src/middleware/validation.js - ADD THESE NEW SCHEMAS

// Add these to your existing validation schemas:

const newSchemas = {
  // Enhanced seat booking schemas
  reserveSeats: Joi.object({
    eventId: Joi.string().uuid().required(),
    selectedSeats: Joi.array()
      .items(Joi.string().uuid())
      .min(1)
      .max(10)
      .required()
      .messages({
        'array.min': 'At least 1 seat must be selected',
        'array.max': 'Maximum 10 seats can be reserved at once'
      }),
    bookingType: Joi.string().valid('GENERAL', 'SEAT_SELECTION', 'VIP_PACKAGE').default('SEAT_SELECTION'),
    promoCode: Joi.string().optional(),
    specialRequests: Joi.string().max(500).optional()
  }),

  confirmBooking: Joi.object({
    paymentDetails: Joi.object({
      method: Joi.string().valid('CARD', 'UPI', 'WALLET', 'NET_BANKING').required(),
      cardNumber: Joi.when('method', {
        is: 'CARD',
        then: Joi.string().creditCard().required(),
        otherwise: Joi.forbidden()
      }),
      cardExpiry: Joi.when('method', {
        is: 'CARD', 
        then: Joi.string().pattern(/^(0[1-9]|1[0-2])\/([0-9]{2})$/).required(),
        otherwise: Joi.forbidden()
      }),
      cardCVV: Joi.when('method', {
        is: 'CARD',
        then: Joi.string().pattern(/^[0-9]{3,4}$/).required(),
        otherwise: Joi.forbidden()
      }),
      upiId: Joi.when('method', {
        is: 'UPI',
        then: Joi.string().email().required(),
        otherwise: Joi.forbidden()
      }),
      walletId: Joi.when('method', {
        is: 'WALLET',
        then: Joi.string().required(),
        otherwise: Joi.forbidden()
      }),
      bankCode: Joi.when('method', {
        is: 'NET_BANKING',
        then: Joi.string().required(),
        otherwise: Joi.forbidden()
      })
    }).required(),
    billingAddress: Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
      phone: Joi.string().pattern(/^[+]?[0-9]{10,15}$/).required(),
      address: Joi.string().required(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      pincode: Joi.string().required(),
      country: Joi.string().default('IN')
    }).optional()
  }),

  cancelBooking: Joi.object({
    reason: Joi.string().valid(
      'CHANGE_OF_PLANS',
      'EVENT_POSTPONED', 
      'DUPLICATE_BOOKING',
      'PRICE_ISSUE',
      'TECHNICAL_ISSUE',
      'OTHER'
    ).required(),
    comments: Joi.string().max(500).optional(),
    refundMethod: Joi.string().valid('ORIGINAL_SOURCE', 'BANK_TRANSFER', 'WALLET').default('ORIGINAL_SOURCE')
  }),

  extendReservation: Joi.object({
    reason: Joi.string().valid('PAYMENT_PROCESSING', 'TECHNICAL_ISSUE', 'USER_REQUEST').required()
  }),

  // Event seat generation (admin)
  generateSeats: Joi.object({
    venueType: Joi.string().valid('THEATER', 'STADIUM', 'CONFERENCE', 'CONCERT', 'AUDITORIUM').default('THEATER'),
    layout: Joi.object({
      sections: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          rows: Joi.array().items(Joi.string()).required(),
          seatsPerRow: Joi.number().integer().min(1).max(50).required(),
          priceMultiplier: Joi.number().min(0.5).max(10).default(1),
          seatTypes: Joi.array().items(
            Joi.string().valid('REGULAR', 'WHEELCHAIR_ACCESSIBLE', 'AISLE', 'PREMIUM', 'VIP')
          ).default(['REGULAR'])
        })
      ).min(1).required()
    }).optional(),
    regenerate: Joi.boolean().default(false),
    blockSeats: Joi.array().items(Joi.string()).optional() // Seat numbers to block
  }),

  // Bulk booking (for corporate/group bookings)
  bulkReserve: Joi.object({
    eventId: Joi.string().uuid().required(),
    ticketCount: Joi.number().integer().min(11).max(100).required(),
    bookingType: Joi.string().valid('CORPORATE', 'GROUP', 'BULK').default('BULK'),
    contactPerson: Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
      phone: Joi.string().required(),
      organization: Joi.string().optional()
    }).required(),
    specialRequests: Joi.string().max(1000).optional()
  }),

  // Waitlist enrollment
  joinWaitlist: Joi.object({
    eventId: Joi.string().uuid().required(),
    ticketCount: Joi.number().integer().min(1).max(10).required(),
    maxPrice: Joi.number().min(0).optional(),
    sectionPreference: Joi.string().optional(),
    notificationPreference: Joi.string().valid('EMAIL', 'SMS', 'PUSH', 'ALL').default('EMAIL')
  }),

  // Admin booking management
  adminBookingAction: Joi.object({
    action: Joi.string().valid('FORCE_CANCEL', 'EXTEND_RESERVATION', 'MARK_USED', 'REFUND').required(),
    reason: Joi.string().required(),
    refundAmount: Joi.when('action', {
      is: 'REFUND',
      then: Joi.number().min(0).required(),
      otherwise: Joi.forbidden()
    }),
    notifyUser: Joi.boolean().default(true)
  }),

  // Reporting and analytics
  bookingReport: Joi.object({
    eventId: Joi.string().uuid().optional(),
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    status: Joi.array().items(
      Joi.string().valid('RESERVED', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'REFUNDED')
    ).optional(),
    groupBy: Joi.string().valid('DAY', 'WEEK', 'MONTH', 'EVENT', 'USER').default('DAY'),
    includeRevenue: Joi.boolean().default(true),
    includeSeats: Joi.boolean().default(false)
  }),

  // Seat map filtering
  seatMapFilter: Joi.object({
    section: Joi.string().optional(),
    priceRange: Joi.object({
      min: Joi.number().min(0).required(),
      max: Joi.number().min(Joi.ref('min')).required()
    }).optional(),
    seatType: Joi.array().items(
      Joi.string().valid('REGULAR', 'WHEELCHAIR_ACCESSIBLE', 'AISLE', 'PREMIUM', 'VIP')
    ).optional(),
    adjacentSeats: Joi.number().integer().min(2).max(10).optional(),
    accessibility: Joi.boolean().optional()
  })
};

module.exports = {
  newSchemas
};