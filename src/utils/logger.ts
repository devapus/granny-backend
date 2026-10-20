import { pino, type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

export type { Logger };

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): Logger {
  return pino({
    level: config.logLevel,
    base: { service: 'memorial-backend', env: config.nodeEnv },
    // Never log credentials, tokens, or personal data that may slip into log objects.
    redact: {
      paths: [
        'password',
        'passwordHash',
        'email',
        '*.password',
        '*.passwordHash',
        '*.email',
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
      ],
      censor: '[redacted]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
