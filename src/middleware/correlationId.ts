import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { CORRELATION_HEADER } from '../constants.js';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Accept a client-supplied correlation id when it is well-formed; otherwise generate one. */
export const correlationId: RequestHandler = (req, res, next) => {
  const incoming = req.header(CORRELATION_HEADER);
  req.correlationId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  req.log = req.ctx.logger.child({ correlationId: req.correlationId });
  next();
};
