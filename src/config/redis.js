const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => console.log('Redis connected'));
redis.on('error', (err) => console.error('Redis error:', err));

const connectRedis = async () => {
  try {
    await redis.ping();
    console.log('Redis connection successful');
    return true;
  } catch (error) {
    console.error('Redis connection failed:', error);
    return false;
  }
};

const cache = {
  async get(key) {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`Cache get error:`, error);
      return null;
    }
  },

  async set(key, value, ttl = 3600) {
    try {
      const serializedValue = JSON.stringify(value);
      if (ttl > 0) {
        await redis.setex(key, ttl, serializedValue);
      } else {
        await redis.set(key, serializedValue);
      }
      return true;
    } catch (error) {
      console.error(`Cache set error:`, error);
      return false;
    }
  },

  async del(key) {
    try {
      return await redis.del(key);
    } catch (error) {
      console.error(`Cache delete error:`, error);
      return false;
    }
  }
};

const lock = {
  async acquire(resource, ttl = 30000) {
    const lockKey = `lock:${resource}`;
    const lockValue = `${Date.now()}-${Math.random()}`;
    
    try {
      const result = await redis.set(lockKey, lockValue, 'PX', ttl, 'NX');
      if (result === 'OK') {
        return { key: lockKey, value: lockValue };
      }
      return null;
    } catch (error) {
      console.error(`Lock acquire error:`, error);
      return null;
    }
  },

  async release(lockKey, lockValue) {
    const script = `
      if redis.call("GET", KEYS) == ARGV then
        return redis.call("DEL", KEYS)
      else
        return 0
      end
    `;
    
    try {
      const result = await redis.eval(script, 1, lockKey, lockValue);
      return result === 1;
    } catch (error) {
      console.error(`Lock release error:`, error);
      return false;
    }
  }
};

module.exports = { redis, connectRedis, cache, lock };
