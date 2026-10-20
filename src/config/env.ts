import { z } from 'zod';

const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());
const intFromEnv = (def: number, min = 1) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).default(def));
const boolFromEnv = z.preprocess(
  (v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : v),
  z.boolean(),
);

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intFromEnv(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  MONGODB_URI: optionalString,
  MONGODB_DB_NAME: optionalString,

  FRONTEND_ORIGIN: optionalString,
  TRUST_PROXY: intFromEnv(1, 0),

  JWT_SECRET: optionalString,
  CSRF_SECRET: optionalString,
  SESSION_TTL_HOURS: intFromEnv(12),
  COOKIE_SAMESITE: z.preprocess(emptyToUndefined, z.enum(['lax', 'strict', 'none']).default('lax')),
  COOKIE_DOMAIN: optionalString,

  ADMIN_BOOTSTRAP_EMAIL: optionalString,
  ADMIN_BOOTSTRAP_PASSWORD: optionalString,

  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  R2_ENDPOINT: optionalString,
  R2_PUBLIC_BASE_URL: optionalString,
  UPLOAD_URL_TTL_SECONDS: intFromEnv(600, 30),
  MAX_IMAGE_BYTES: intFromEnv(10 * 1024 * 1024),
  MAX_VIDEO_BYTES: intFromEnv(200 * 1024 * 1024),

  RATE_LIMIT_GLOBAL_MAX: intFromEnv(600),
  RATE_LIMIT_GLOBAL_WINDOW_MS: intFromEnv(15 * 60 * 1000),
  RATE_LIMIT_AUTH_MAX: intFromEnv(10),
  RATE_LIMIT_AUTH_WINDOW_MS: intFromEnv(15 * 60 * 1000),
  RATE_LIMIT_TRIBUTE_MAX: intFromEnv(5),
  RATE_LIMIT_TRIBUTE_WINDOW_MS: intFromEnv(60 * 60 * 1000),
  RATE_LIMIT_UPLOAD_MAX: intFromEnv(20),
  RATE_LIMIT_UPLOAD_WINDOW_MS: intFromEnv(60 * 60 * 1000),

  ENABLE_DOCS: z.preprocess(emptyToUndefined, boolFromEnv.optional()),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  isTest: boolean;
  port: number;
  logLevel: string;

  mongodbUri?: string;
  mongodbDbName?: string;

  frontendOrigins: string[];
  trustProxy: number;

  jwtSecret: string;
  csrfSecret: string;
  sessionTtlHours: number;
  cookieSameSite: 'lax' | 'strict' | 'none';
  cookieDomain?: string;

  adminBootstrapEmail?: string;
  adminBootstrapPassword?: string;

  r2: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
    endpoint?: string;
    publicBaseUrl?: string;
  };
  uploadUrlTtlSeconds: number;
  maxImageBytes: number;
  maxVideoBytes: number;

  rateLimits: {
    global: { max: number; windowMs: number };
    auth: { max: number; windowMs: number };
    tribute: { max: number; windowMs: number };
    upload: { max: number; windowMs: number };
  };

  enableDocs: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration from an environment-like object.
 * Throws ConfigError with a readable list of problems.
 */
export function loadConfig(
  source: Record<string, string | undefined> = process.env,
  overrides: Partial<AppConfig> = {},
): AppConfig {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const isTest = e.NODE_ENV === 'test';
  const problems: string[] = [];

  if (isProduction) {
    if (!e.MONGODB_URI) problems.push('MONGODB_URI is required in production');
    if (!e.FRONTEND_ORIGIN) problems.push('FRONTEND_ORIGIN is required in production');
    if (!e.JWT_SECRET || e.JWT_SECRET.length < 32) problems.push('JWT_SECRET (min 32 chars) is required in production');
    if (e.CSRF_SECRET !== undefined && e.CSRF_SECRET.length < 32) problems.push('CSRF_SECRET must be at least 32 chars');
  }
  if (e.ADMIN_BOOTSTRAP_PASSWORD && e.ADMIN_BOOTSTRAP_PASSWORD.length < 12) {
    problems.push('ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters');
  }
  if (e.ADMIN_BOOTSTRAP_EMAIL && !z.email().safeParse(e.ADMIN_BOOTSTRAP_EMAIL).success) {
    problems.push('ADMIN_BOOTSTRAP_EMAIL must be a valid email address');
  }

  const origins = (e.FRONTEND_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const o of origins) {
    try {
      new URL(o);
    } catch {
      problems.push(`FRONTEND_ORIGIN contains an invalid origin: ${o}`);
    }
  }
  if (isProduction && origins.includes('*')) problems.push('FRONTEND_ORIGIN must not be a wildcard');

  if (problems.length) throw new ConfigError(problems);

  const jwtSecret = e.JWT_SECRET ?? DEV_SECRET;

  const config: AppConfig = {
    nodeEnv: e.NODE_ENV,
    isProduction,
    isTest,
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
    mongodbUri: e.MONGODB_URI,
    mongodbDbName: e.MONGODB_DB_NAME,
    frontendOrigins: origins,
    trustProxy: e.TRUST_PROXY,
    jwtSecret,
    csrfSecret: e.CSRF_SECRET ?? `${jwtSecret}:csrf`,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSameSite: e.COOKIE_SAMESITE,
    cookieDomain: e.COOKIE_DOMAIN,
    adminBootstrapEmail: e.ADMIN_BOOTSTRAP_EMAIL?.toLowerCase(),
    adminBootstrapPassword: e.ADMIN_BOOTSTRAP_PASSWORD,
    r2: {
      accountId: e.R2_ACCOUNT_ID,
      accessKeyId: e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY,
      bucket: e.R2_BUCKET,
      endpoint: e.R2_ENDPOINT,
      publicBaseUrl: e.R2_PUBLIC_BASE_URL?.replace(/\/+$/, ''),
    },
    uploadUrlTtlSeconds: e.UPLOAD_URL_TTL_SECONDS,
    maxImageBytes: e.MAX_IMAGE_BYTES,
    maxVideoBytes: e.MAX_VIDEO_BYTES,
    rateLimits: {
      global: { max: e.RATE_LIMIT_GLOBAL_MAX, windowMs: e.RATE_LIMIT_GLOBAL_WINDOW_MS },
      auth: { max: e.RATE_LIMIT_AUTH_MAX, windowMs: e.RATE_LIMIT_AUTH_WINDOW_MS },
      tribute: { max: e.RATE_LIMIT_TRIBUTE_MAX, windowMs: e.RATE_LIMIT_TRIBUTE_WINDOW_MS },
      upload: { max: e.RATE_LIMIT_UPLOAD_MAX, windowMs: e.RATE_LIMIT_UPLOAD_WINDOW_MS },
    },
    enableDocs: e.ENABLE_DOCS ?? !isProduction,
  };

  return { ...config, ...overrides };
}
