import type { Request, RequestHandler } from 'express';
import type { QueryFilter } from 'mongoose';
import { GALLERY_CATEGORIES } from '../constants.js';
import { parse } from '../middleware/validate.js';
import { Media, type IMedia } from '../models/Media.js';
import { completeUpload, createUploadUrl, requireStorage, verifyCompletionToken } from '../services/media.js';
import { getSiteConfig } from '../services/siteConfig.js';
import { getPublicTribute, listPublicTributes, submitTribute } from '../services/tributes.js';
import { serializePublicConfig } from '../serializers/config.js';
import { serializePublicGalleryItem } from '../serializers/media.js';
import { serializePublicTributes, serializeSubmissionReceipt } from '../serializers/tribute.js';
import { notFound, validationError } from '../utils/errors.js';
import { parseIdParam } from '../utils/objectId.js';
import { pageMeta } from '../utils/pagination.js';
import {
  completeUploadBody,
  publicGalleryListQuery,
  publicTributeListQuery,
  submissionIdSchema,
  tributeSubmissionSchema,
  uploadUrlBody,
} from '../validation/schemas.js';

export const getPublicConfig: RequestHandler = async (req, res) => {
  const config = await getSiteConfig();
  res.json({ data: await serializePublicConfig(req.ctx, config) });
};

export const listTributes: RequestHandler = async (req, res) => {
  const q = parse(publicTributeListQuery, req.query);
  const config = await getSiteConfig();
  const { items, total } = await listPublicTributes(config, q);
  res.json({
    data: await serializePublicTributes(req.ctx, items, config),
    meta: pageMeta(q.page, q.limit, total),
  });
};

export const getTribute: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Tribute');
  const [config, tribute] = await Promise.all([getSiteConfig(), getPublicTribute(id)]);
  const [data] = await serializePublicTributes(req.ctx, [tribute], config);
  res.json({ data });
};

function headerSubmissionId(req: Request): string | undefined {
  const raw = req.header('idempotency-key') ?? req.header('x-submission-id');
  if (raw === undefined) return undefined;
  const parsed = submissionIdSchema.safeParse(raw.trim());
  if (!parsed.success) {
    throw validationError([{ path: 'Idempotency-Key', message: 'Idempotency key must be a UUID' }]);
  }
  return parsed.data;
}

export const createTribute: RequestHandler = async (req, res) => {
  const body = parse(tributeSubmissionSchema, req.body);
  const config = await getSiteConfig();
  const { tribute, created } = await submitTribute(config, body, headerSubmissionId(req));
  if (!created) res.setHeader('Idempotent-Replay', 'true');
  res.status(created ? 201 : 200).json({ data: serializeSubmissionReceipt(tribute) });
};

function galleryFilter(allowVideos: boolean): QueryFilter<IMedia> {
  const f: QueryFilter<IMedia> = {
    category: { $in: [...GALLERY_CATEGORIES] },
    visibility: 'public',
    moderationStatus: 'approved',
    uploadStatus: 'uploaded',
    deletedAt: null,
  };
  if (!allowVideos) f.mediaType = 'image';
  return f;
}

export const listGallery: RequestHandler = async (req, res) => {
  const q = parse(publicGalleryListQuery, req.query);
  const config = await getSiteConfig();
  if (!config.gallery.enabled) {
    res.json({ data: [], meta: pageMeta(q.page, q.limit, 0) });
    return;
  }
  const filter = galleryFilter(config.gallery.allowVideos);
  if (q.category) filter.category = q.category;
  if (q.mediaType) filter.mediaType = q.mediaType;
  const [items, total] = await Promise.all([
    Media.find(filter)
      .sort({ displayOrder: 1, uploadedAt: -1, _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<IMedia[]>(),
    Media.countDocuments(filter),
  ]);
  res.json({
    data: await Promise.all(items.map((m) => serializePublicGalleryItem(req.ctx, m))),
    meta: pageMeta(q.page, q.limit, total),
  });
};

export const getGalleryItem: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Gallery item');
  const config = await getSiteConfig();
  if (!config.gallery.enabled) throw notFound('Gallery item not found');
  const item = await Media.findOne({ ...galleryFilter(config.gallery.allowVideos), _id: id }).lean<IMedia>();
  if (!item) throw notFound('Gallery item not found');
  res.json({ data: await serializePublicGalleryItem(req.ctx, item) });
};

export const publicUploadUrl: RequestHandler = async (req, res) => {
  const body = parse(uploadUrlBody, req.body);
  const result = await createUploadUrl(req.ctx, { ...body, isPublic: true });
  res.status(201).json({ data: result });
};

export const publicCompleteUpload: RequestHandler = async (req, res) => {
  const body = parse(completeUploadBody, req.body);
  requireStorage(req.ctx);
  verifyCompletionToken(req.ctx, body.completionToken, body.mediaId);
  const media = await completeUpload(
    req.ctx,
    parseIdParam(body.mediaId, 'Media'),
    { width: body.width, height: body.height },
    { isPublic: true },
  );
  res.json({
    data: { mediaId: String(media._id), status: media.uploadStatus, mimeType: media.mimeType, fileSize: media.fileSize },
  });
};
