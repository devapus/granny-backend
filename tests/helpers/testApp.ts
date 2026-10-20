import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../src/createApp.js';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { connectDb, disconnectDb } from '../../src/db/connection.js';
import { Administrator } from '../../src/models/Administrator.js';
import { allModels } from '../../src/models/index.js';
import { hashPassword, resetBootstrapFlag } from '../../src/services/auth.js';
import { createLogger } from '../../src/utils/logger.js';
import { FakeStorage } from './fakeStorage.js';

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'correct-horse-battery-staple';

export interface TestEnv {
  app: Express;
  storage: FakeStorage;
  config: AppConfig;
}

export interface SetupOptions {
  env?: Record<string, string>;
  storage?: FakeStorage;
  configOverrides?: Partial<AppConfig>;
}

/**
 * Registers beforeAll/afterAll/beforeEach hooks that give each test file its own database on the
 * shared in-memory MongoDB, with a clean state before every test. Returns a live holder
 * (properties are populated in beforeAll).
 */
export function useTestApp(options: SetupOptions = {}): TestEnv {
  const holder = {} as TestEnv;

  beforeAll(async () => {
    const dbName = `test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const config = loadConfig(
      {
        NODE_ENV: 'test',
        FRONTEND_ORIGIN: 'http://localhost:3000',
        MONGODB_URI: inject('mongoUri'),
        MONGODB_DB_NAME: dbName,
        // generous limits by default; individual tests override
        RATE_LIMIT_GLOBAL_MAX: '10000',
        RATE_LIMIT_AUTH_MAX: '1000',
        RATE_LIMIT_TRIBUTE_MAX: '1000',
        RATE_LIMIT_UPLOAD_MAX: '1000',
        ...options.env,
      },
      options.configOverrides,
    );
    await connectDb(config);
    holder.config = config;
    holder.storage = options.storage ?? new FakeStorage();
    holder.app = createApp({
      config,
      logger: createLogger(config),
      storage: holder.storage,
    });
  });

  beforeEach(async () => {
    resetBootstrapFlag();
    await Promise.all(allModels.map((m) => m.deleteMany({})));
    holder.storage.objects.clear();
    holder.storage.deleted.length = 0;
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await disconnectDb();
  });

  return holder;
}

export const validTribute = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  relationshipCategory: 'grandchildren',
  tributeText: 'She made the best apple pie and always had time for a story. We miss her every day.',
  photoDisplayPermission: false,
  acknowledgment: true,
  ...overrides,
});

export async function createAdmin(email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
  return Administrator.create({ email, passwordHash: await hashPassword(password), role: 'admin', isActive: true });
}

/** Returns a supertest agent that holds cookies and a CSRF token helper. */
export async function csrfAgent(app: Express) {
  const agent = request.agent(app);
  const res = await agent.get('/api/v1/csrf-token').expect(200);
  const token = res.body.data.csrfToken as string;
  return {
    agent,
    token,
    post: (url: string) => agent.post(url).set('X-CSRF-Token', token),
    put: (url: string) => agent.put(url).set('X-CSRF-Token', token),
    patch: (url: string) => agent.patch(url).set('X-CSRF-Token', token),
    delete: (url: string) => agent.delete(url).set('X-CSRF-Token', token),
    get: (url: string) => agent.get(url),
  };
}

export async function loggedInAdmin(app: Express) {
  await createAdmin();
  const c = await csrfAgent(app);
  await c.post('/api/v1/admin/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(200);
  return c;
}

/** Create a tribute through the public API; returns its id. */
export async function submitTribute(app: Express, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app).post('/api/v1/tributes').send(validTribute(overrides)).expect(201);
  return res.body.data.id as string;
}
