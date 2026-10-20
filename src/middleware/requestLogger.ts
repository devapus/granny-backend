import type { RequestHandler } from 'express';

/** Structured access log. Query strings, bodies and cookies are intentionally never logged. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(ms * 10) / 10 },
      'request',
    );
  });
  next();
};
