import { Redis } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
};

// BullMQ needs ioredis instance. explicit casting might help if versions drift
export const connection = new Redis(redisConfig);
