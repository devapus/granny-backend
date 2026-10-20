import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { AppError, type ErrorDetail } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

interface HttpLikeError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: number | string;
}

/**
 * Uniform error format:
 * { "error": { "code": "...", "message": "...", "details": [...], "correlationId": "..." } }
 * Stack traces are never returned in production (only in development for 5xx).
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const isProd = req.ctx?.config.isProduction ?? true;
  const showStack = req.ctx?.config.nodeEnv === 'development';

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: ErrorDetail[] | undefined;

  const e = err as HttpLikeError;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
  } else if (e?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
  } else if (e?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (e?.type === 'charset.unsupported' || e?.type === 'encoding.unsupported') {
    status = 415;
    code = 'UNSUPPORTED_ENCODING';
    message = 'Unsupported request encoding';
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = Object.values(err.errors).map((x) => ({ path: x.path, message: x.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid identifier or value';
  } else if (e?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A resource with these unique values already exists';
  } else if (
    err instanceof mongoose.Error.MongooseServerSelectionError ||
    e?.name === 'MongoServerSelectionError' ||
    e?.name === 'MongoNetworkError'
  ) {
    status = 503;
    code = 'DATABASE_UNAVAILABLE';
    message = 'The database is temporarily unavailable';
  } else if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
    status = e.status;
    code = 'BAD_REQUEST';
    message = status === 403 ? 'Forbidden' : 'Bad request';
  }

  const log = req.log ?? req.ctx?.logger;
  if (status >= 500 && !(err instanceof AppError)) {
    log?.error({ err, status, code }, 'Unhandled error');
  } else if (status >= 500) {
    log?.warn({ status, code, message }, 'Service error');
  } else {
    log?.debug({ status, code }, 'Request error');
  }

  const body: { error: Record<string, unknown> } = {
    error: { code, message, correlationId: req.correlationId },
  };
  if (details && details.length) body.error.details = details;
  if (showStack && status >= 500 && !isProd && !(err instanceof AppError) && e?.stack) body.error.stack = e.stack;

  res.status(status).json(body);
};
