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
