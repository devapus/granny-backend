import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { loadConfig } from './config/env.js';
import { API_PREFIX, CORRELATION_HEADER, CSRF_HEADER } from './constants.js';
import type { AppContext } from './context.js';
import { connectDb } from './db/connection.js';
import { createDocsRouter } from './docs.js';
import { correlationId } from './middleware/correlationId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { makeLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createApiRouter } from './routes/index.js';
import { R2StorageService, type StorageService } from './services/r2.js';
import { AppError } from './utils/errors.js';
import { createLogger, type Logger } from './utils/logger.js';

export interface CreateAppOptions {
  config?: AppConfig;
  logger?: Logger;
  storage?: StorageService;
  ensureDb?: () => Promise<void>;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config);
  const storage = options.storage ?? new R2StorageService(config.r2);
  const ctx: AppContext = {
    config,
    logger,
    storage,
    ensureDb:
      options.ensureDb ??
      (async () => {
        await connectDb(config, logger);
      }),
  };

  if (!storage.isConfigured()) {
    logger.warn('Cloudflare R2 is not configured: media endpoints will return 503 STORAGE_NOT_CONFIGURED');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use(correlationId);
  app.use(requestLogger);

  if (config.enableDocs) app.use('/api', createDocsRouter());

  // cross-origin: the API is served on a different host from the memorial site (and from the Vite proxy in local).
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      const allowed =
        !origin ||
        config.frontendOrigins.includes(origin.replace(/\/+$/, '')) ||
        (() => {
          try {
            return new URL(origin).host === req.headers.host;
          } catch {
            return false;
          }
        })();
      if (!allowed) {
        callback(new AppError(403, 'CORS_ORIGIN_REJECTED', 'Origin not allowed'));
        return;
      }
      callback(null, {
        origin: true,
        credentials: true,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', CSRF_HEADER, 'Idempotency-Key', 'X-Submission-Id', CORRELATION_HEADER],
        exposedHeaders: [CORRELATION_HEADER, 'Idempotent-Replay', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
        maxAge: 600,
      });
    }),
  );

  app.use(
    makeLimiter({
      ...config.rateLimits.global,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(API_PREFIX, createApiRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
