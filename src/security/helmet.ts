import type { RequestHandler } from 'express';
import helmetImport from 'helmet';

type HelmetOptions = {
  contentSecurityPolicy?: false | { directives?: Record<string, unknown> };
  crossOriginResourcePolicy?: false | { policy?: 'same-origin' | 'same-site' | 'cross-origin' };
  [key: string]: unknown;
};

type HelmetFn = (options?: HelmetOptions) => RequestHandler;

/**
 * Helmet ships CJS typings (`.d.cts`). Under `moduleResolution: NodeNext`, some checkers
 * (including Vercel's) treat the default import as a non-callable module namespace.
 */
function resolveHelmet(): HelmetFn {
  const mod = helmetImport as unknown as HelmetFn | { default: HelmetFn };
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.default === 'function') return mod.default;
  throw new Error('helmet export is not callable');
}

export const helmet: HelmetFn = resolveHelmet();
