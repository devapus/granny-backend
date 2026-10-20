import { Router, type RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import {
  adminApproveTribute,
  adminCompleteUpload,
  adminCreateGalleryItem,
  adminDeleteGalleryItem,
  adminGetConfig,
  adminGetGalleryItem,
  adminGetTribute,
  adminListAuditEvents,
  adminListGallery,
  adminListTributes,
  adminOrderTributes,
  adminPatchCategories,
  adminPatchConfig,
  adminPatchGalleryItem,
  adminPatchTribute,
  adminRejectTribute,
  adminRemoveTribute,
  adminUploadUrl,
  login,
  logout,
  me,
} from '../controllers/admin.js';
import { requireAdmin } from '../middleware/auth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { makeLimiter } from '../middleware/rateLimit.js';

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export function createAdminRouter(ctx: AppContext): Router {
  const router = Router();
  const authLimiter = makeLimiter({
    ...ctx.config.rateLimits.auth,
    code: 'RATE_LIMITED',
    message: 'Too many login attempts. Please try again later.',
  });

  router.use(noStore);
  // CSRF applies to every state-changing admin request, including login/logout.
  router.use(csrfProtection);

  router.post('/auth/login', authLimiter, login);
  router.post('/auth/logout', logout);

  // Everything below requires an authenticated administrator.
  router.use(requireAdmin);
  router.get('/auth/me', me);

  router.get('/tributes', adminListTributes);
  router.put('/tributes/order', adminOrderTributes); // must precede /tributes/:id
  router.get('/tributes/:id', adminGetTribute);
  router.patch('/tributes/:id', adminPatchTribute);
  router.post('/tributes/:id/approve', adminApproveTribute);
  router.post('/tributes/:id/reject', adminRejectTribute);
  router.post('/tributes/:id/remove', adminRemoveTribute);
  router.delete('/tributes/:id', adminRemoveTribute);

  router.get('/gallery', adminListGallery);
  router.post('/gallery', adminCreateGalleryItem);
  router.get('/gallery/:id', adminGetGalleryItem);
  router.patch('/gallery/:id', adminPatchGalleryItem);
  router.delete('/gallery/:id', adminDeleteGalleryItem);

  router.post('/media/upload-url', adminUploadUrl);
  router.post('/media/complete', adminCompleteUpload);

  router.get('/config', adminGetConfig);
  router.patch('/config', adminPatchConfig);
  router.patch('/categories', adminPatchCategories);

  router.get('/audit-events', adminListAuditEvents);

  return router;
}
