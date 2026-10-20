import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { CookieOptions, Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import { Administrator, type IAdministrator } from '../models/Administrator.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../constants.js';

// Low cost factor only under test to keep the suite fast; production always uses 12.
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
const JWT_ISSUER = 'house-of-memories';
const JWT_AUDIENCE = 'hom-admin';

// Used to equalise timing when the account does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(plain, hash ?? DUMMY_HASH).then((ok) => ok && Boolean(hash));
}

export interface SessionClaims {
  sub: string;
  role: 'admin';
}

export function signSession(config: AppConfig, admin: Pick<IAdministrator, '_id' | 'role'>): string {
  return jwt.sign({ role: admin.role }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(admin._id),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: config.sessionTtlHours * 3600,
  });
}

export function verifySession(config: AppConfig, token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload === 'string' || !payload.sub || payload.role !== 'admin') return null;
    return { sub: payload.sub, role: 'admin' };
  } catch {
    return null;
  }
}

function baseCookieOptions(config: AppConfig): CookieOptions {
  return {
    sameSite: config.cookieSameSite,
    // SameSite=None requires Secure; in production we always require HTTPS.
    secure: config.isProduction || config.cookieSameSite === 'none',
    domain: config.cookieDomain,
    path: '/',
  };
}

export function setSessionCookie(config: AppConfig, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    ...baseCookieOptions(config),
    httpOnly: true,
    maxAge: config.sessionTtlHours * 3600 * 1000,
  });
}

export function clearSessionCookie(config: AppConfig, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...baseCookieOptions(config), httpOnly: true });
}

export function readSessionToken(req: Request): string | undefined {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// ---------------- CSRF (signed double-submit cookie) ----------------

function csrfSignature(config: AppConfig, nonce: string): string {
  return createHmac('sha256', config.csrfSecret).update(nonce).digest('base64url');
}

export function createCsrfToken(config: AppConfig): string {
  const nonce = randomBytes(24).toString('base64url');
  return `${nonce}.${csrfSignature(config, nonce)}`;
}

export function isValidCsrfToken(config: AppConfig, token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const [nonce, sig, ...rest] = token.split('.');
  if (!nonce || !sig || rest.length > 0) return false;
  const expected = Buffer.from(csrfSignature(config, nonce));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function setCsrfCookie(config: AppConfig, res: Response, token: string): void {
  res.cookie(CSRF_COOKIE, token, {
    ...baseCookieOptions(config),
    // Intentionally readable by same-site JS; the token is also returned in the response body.
    httpOnly: false,
    maxAge: config.sessionTtlHours * 3600 * 1000,
  });
}

// ---------------- Admin bootstrap ----------------

let bootstrapDone = false;

/** Reset (tests only). */
export function resetBootstrapFlag(): void {
  bootstrapDone = false;
}

/**
 * Create the first administrator from env if (and only if) no administrator exists.
 * Safe to call repeatedly / concurrently: it is a no-op once any admin exists.
 */
export async function bootstrapAdmin(config: AppConfig, logger: Logger): Promise<boolean> {
  if (bootstrapDone) return false;
  if (!config.adminBootstrapEmail || !config.adminBootstrapPassword) {
    bootstrapDone = true;
    return false;
  }
  if (await Administrator.exists({})) {
    bootstrapDone = true;
    return false;
  }
  const passwordHash = await hashPassword(config.adminBootstrapPassword);
  const res = await Administrator.updateOne(
    { email: config.adminBootstrapEmail },
    { $setOnInsert: { email: config.adminBootstrapEmail, passwordHash, role: 'admin', isActive: true, createdAt: new Date() } },
    { upsert: true },
  );
  bootstrapDone = true;
  if (res.upsertedCount > 0) {
    logger.info('Bootstrap administrator created');
    return true;
  }
  return false;
}
