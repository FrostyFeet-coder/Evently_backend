const { Sequelize } = require('sequelize');
const { sequelize } = require('../config/database');

// Import model definitions (these are functions)
const UserModel = require('./User');
const EventModel = require('./Event');
const BookingModel = require('./Booking');
const WaitlistModel = require('./Waitlist');

// Initialize models by calling the functions
const User = UserModel(sequelize, Sequelize.DataTypes);
const Event = EventModel(sequelize, Sequelize.DataTypes);
const Booking = BookingModel(sequelize, Sequelize.DataTypes);
const Waitlist = WaitlistModel(sequelize, Sequelize.DataTypes);

// Define associations
User.hasMany(Event, { foreignKey: 'createdBy', as: 'createdEvents' });
User.hasMany(Booking, { foreignKey: 'userId', as: 'bookings' });
User.hasMany(Waitlist, { foreignKey: 'userId', as: 'waitlistEntries' });

Event.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
Event.hasMany(Booking, { foreignKey: 'eventId', as: 'bookings' });
Event.hasMany(Waitlist, { foreignKey: 'eventId', as: 'waitlist' });

Booking.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Booking.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

Waitlist.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Waitlist.belongsTo(Event, { foreignKey: 'eventId', as: 'event' });

// Export the initialized models
module.exports = {
  User,
  Event,
  Booking,
  Waitlist,
  sequelize,
  Sequelize
};
