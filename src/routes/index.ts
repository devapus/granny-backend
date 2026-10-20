import { Router } from 'express';
import type { AppContext } from '../context.js';
import { withDatabase } from '../middleware/database.js';
import { issueCsrfToken } from '../controllers/admin.js';
import { dbState } from '../db/connection.js';
import { createAdminRouter } from './admin.js';
import { createPublicRouter } from './public.js';

export function createApiRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { status: 'ok', time: new Date().toISOString() } });
  });

  router.get('/csrf-token', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    issueCsrfToken(req, res, next);
  });

  router.use(withDatabase);

  router.get('/health/ready', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { status: 'ready', database: dbState() } });
  });

  router.use('/admin', createAdminRouter(ctx));
  router.use('/', createPublicRouter(ctx));

  return router;
}
