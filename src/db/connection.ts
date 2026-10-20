import mongoose from 'mongoose';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import { allModels } from '../models/index.js';

mongoose.set('strictQuery', true);
interface Cache {
  promise: Promise<typeof mongoose> | null;
  key: string | null;
}

// Cached on globalThis so warm serverless invocations reuse the same connection.
const g = globalThis as unknown as { __homMongo?: Cache };
const cache: Cache = (g.__homMongo ??= { promise: null, key: null });

export async function connectDb(
  config: Pick<AppConfig, 'mongodbUri' | 'mongodbDbName'>,
  logger?: Logger,
): Promise<typeof mongoose> {
  if (!config.mongodbUri) {
    throw new Error('MONGODB_URI is not configured; cannot connect to the database');
  }
  const key = `${config.mongodbUri}|${config.mongodbDbName ?? ''}`;
  if (cache.promise && cache.key === key && mongoose.connection.readyState !== 0) {
    return cache.promise;
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  cache.key = key;
  cache.promise = (async () => {
    try {
      const conn = await mongoose.connect(config.mongodbUri as string, {
        dbName: config.mongodbDbName,
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 10,
        bufferCommands: false,
        autoIndex: true,
      });
      await Promise.all(allModels.map((m) => m.init()));
      logger?.info('MongoDB connected');
      return conn;
    } catch (err) {
      cache.promise = null;
      cache.key = null;
      throw err;
    }
  })();
  return cache.promise;
}

export async function disconnectDb(): Promise<void> {
  cache.promise = null;
  cache.key = null;
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export function dbState(): 'connected' | 'connecting' | 'disconnected' {
  const s = mongoose.connection.readyState;
  return s === 1 ? 'connected' : s === 2 ? 'connecting' : 'disconnected';
}
