/**
 * Vercel Express entrypoint (zero-config).
 * Local development continues to use `pnpm dev` → `src/index.ts` (listen + bootstrap).
 */
import 'dotenv/config';
import type { Express, Request, Response } from 'express';
import { createApp } from './app.js';

let app: Express | ((req: Request, res: Response) => void);

try {
  app = createApp();
} catch (err) {
  // Fail loudly if production env vars are missing; still export a handler so the deploy is diagnosable.
  console.error(err instanceof Error ? err.message : err);
  app = (_req: Request, res: Response) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'MISCONFIGURED',
          message:
            'Server configuration is invalid. Set MONGODB_URI, FRONTEND_ORIGIN, and JWT_SECRET (min 32 chars) in the Vercel project environment.',
        },
      }),
    );
  };
}

export default app;
