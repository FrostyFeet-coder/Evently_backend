module.exports = (sequelize, DataTypes) => {
  const Waitlist = sequelize.define('Waitlist', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1 }
    },
    status: {
      type: DataTypes.ENUM('WAITING', 'NOTIFIED', 'PROMOTED', 'EXPIRED'),
      defaultValue: 'WAITING'
    },
    ticketsRequested: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: { min: 1, max: 10 }
    }
  });

  return Waitlist;
};
