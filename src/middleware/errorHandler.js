const { create } = require('qrcode');
const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
// src/middleware/errorHandler.js
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}


const createError = {
  badRequest: (message) => new AppError(message, 400),
  unauthorized: (message) => new AppError(message, 401),
  notFound: (message) => new AppError(message, 404),
  gone: (message) => new AppError(message, 410),
  internal: (message) => new AppError(message, 500),
};


const errorHandler = (err, req, res, next) => {
  let { statusCode = 500, message } = err;

  // Handle Sequelize validation errors
  if (err.name === 'SequelizeValidationError') {
    statusCode = 400;
    message = err.errors.map(e => e.message).join(', ');
  }

  // Handle Sequelize unique constraint errors
  if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    message = 'Resource already exists';
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  logger.error(`${statusCode} - ${message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = {errorHandler , asyncHandler, createError};
module.exports.AppError = AppError;
