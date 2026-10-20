import { Router, type RequestHandler } from 'express';
import type { AppContext } from '../context.js';
import {
  createTribute,
  getGalleryItem,
  getPublicConfig,
  getTribute,
  listGallery,
  listTributes,
  publicCompleteUpload,
  publicUploadUrl,
} from '../controllers/public.js';
import { makeLimiter } from '../middleware/rateLimit.js';

const publicCache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  next();
};
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export function createPublicRouter(ctx: AppContext): Router {
  const router = Router();
  const { tribute, upload } = ctx.config.rateLimits;

  const tributeLimiter = makeLimiter({
    ...tribute,
    code: 'RATE_LIMITED',
    message: 'Too many tribute submissions from this address. Please try again later.',
  });
  const uploadLimiter = makeLimiter({
    ...upload,
    code: 'RATE_LIMITED',
    message: 'Too many upload requests from this address. Please try again later.',
  });

  router.get('/public/config', publicCache, getPublicConfig);

  router.get('/tributes', publicCache, listTributes);
  router.get('/tributes/:id', publicCache, getTribute);
  router.post('/tributes', noStore, tributeLimiter, createTribute);

  router.get('/gallery', publicCache, listGallery);
  router.get('/gallery/:id', publicCache, getGalleryItem);

  router.post('/media/upload-url', noStore, uploadLimiter, publicUploadUrl);
  router.post('/media/complete', noStore, uploadLimiter, publicCompleteUpload);

  return router;
}
