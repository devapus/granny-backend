import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { Administrator } from '../models/Administrator.js';
import { readSessionToken, verifySession } from '../services/auth.js';
import { unauthorized } from '../utils/errors.js';

/** Require a valid admin session cookie; loads the (active) administrator onto req.admin. */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const token = readSessionToken(req);
  if (!token) return next(unauthorized());
  const claims = verifySession(req.ctx.config, token);
  if (!claims || !Types.ObjectId.isValid(claims.sub)) return next(unauthorized('Invalid or expired session'));

  const admin = await Administrator.findById(claims.sub).lean();
  if (!admin || !admin.isActive) return next(unauthorized('Invalid or expired session'));
  req.admin = admin;
  next();
};
