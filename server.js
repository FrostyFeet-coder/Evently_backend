require('dotenv').config();
const app = require('./src/app');
const { sequelize } = require('./src/config/database');
const { connectRedis } = require('./src/config/redis');
const logger = require('./src/utils/logger');

// Import models to ensure they are initialized
require('./src/models');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    logger.info(' Database connection established');
    
    // Connect to Redis
    await connectRedis();
    logger.info(' Redis connection established');
    
    // Sync database in development
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      logger.info('Database synchronized');
    }
    
    // Test models are loaded
    const { User } = require('./src/models');
    console.log('Models loaded successfully, User:', !!User);
    
    app.listen(PORT, () => {
      logger.info(` Server running on port ${PORT}`);
      logger.info(` Test endpoints: http://localhost:${PORT}/api`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    console.error('Detailed error:', error);
    process.exit(1);
  }
}

startServer();
