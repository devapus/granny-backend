import type { RequestHandler } from 'express';
import helmetImport from 'helmet';
import { asCallable } from './cjsDefault.js';

type HelmetOptions = {
  contentSecurityPolicy?: false | { directives?: Record<string, unknown> };
  crossOriginResourcePolicy?: false | { policy?: 'same-origin' | 'same-site' | 'cross-origin' };
  [key: string]: unknown;
};

type HelmetFn = (options?: HelmetOptions) => RequestHandler;

export const helmet: HelmetFn = asCallable<HelmetFn>(helmetImport, 'helmet');
