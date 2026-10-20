import type { RequestHandler } from 'express';
import { bootstrapAdmin } from '../services/auth.js';

/** Ensure the DB connection (cached across warm serverless invocations) and run one-time bootstrap. */
export const withDatabase: RequestHandler = async (req, _res, next) => {
  await req.ctx.ensureDb();
  await bootstrapAdmin(req.ctx.config, req.log);
  next();
};
