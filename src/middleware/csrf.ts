import type { RequestHandler } from 'express';
import { CSRF_COOKIE, CSRF_HEADER } from '../constants.js';
import { isValidCsrfToken } from '../services/auth.js';
import { forbidden } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit CSRF protection for cookie-authenticated (admin) mutations.
 * The client obtains a token from GET /api/v1/csrf-token (cookie + JSON body) and echoes it
 * in the X-CSRF-Token header. The header must equal the cookie and carry a valid signature.
 * Additionally, if an Origin header is present it must be an allowed frontend origin.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const { config } = req.ctx;

  const origin = req.header('origin');
  if (origin && !config.frontendOrigins.includes(origin.replace(/\/+$/, ''))) {
    return next(forbidden('Origin not allowed', 'CSRF_ORIGIN_REJECTED'));
  }

  const cookieToken = (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];
  const headerToken = req.header(CSRF_HEADER);
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken !== headerToken ||
    !isValidCsrfToken(config, headerToken)
  ) {
    return next(forbidden('Missing or invalid CSRF token', 'CSRF_TOKEN_INVALID'));
  }
  next();
};
