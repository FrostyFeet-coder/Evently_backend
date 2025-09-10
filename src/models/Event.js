module.exports = (sequelize, DataTypes) => {
  const Event = sequelize.define('Event', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { len: [3, 200] }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    venue: {
      type: DataTypes.STRING,
      allowNull: false
    },
    dateTime: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isAfter: new Date().toISOString()
      }
    },
    capacity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 }
    },
    availableSeats: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: { min: 0 }
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'USD'
    },
    category: {
      type: DataTypes.ENUM('CONCERT', 'CONFERENCE', 'WORKSHOP', 'SPORTS', 'THEATER', 'OTHER'),
      defaultValue: 'OTHER'
    },
    status: {
      type: DataTypes.ENUM('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'),
      defaultValue: 'DRAFT'
    },
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false
    }
  }, {
    hooks: {
      beforeCreate: (event) => {
        event.availableSeats = event.capacity;
      }
    }
  });

  Event.prototype.isBookable = function() {
    return this.status === 'PUBLISHED' 
      && this.availableSeats > 0 
      && new Date() < new Date(this.dateTime);
  };

  return Event;
};
