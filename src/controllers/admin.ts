import type { RequestHandler } from 'express';
import { Types, type QueryFilter } from 'mongoose';
import { CSRF_COOKIE, CSRF_HEADER, GALLERY_CATEGORIES } from '../constants.js';
import { parse } from '../middleware/validate.js';
import { Administrator, type IAdministrator } from '../models/Administrator.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { Media, type IMedia } from '../models/Media.js';
import { Tribute } from '../models/Tribute.js';
import { recordAudit } from '../services/audit.js';
import {
  clearSessionCookie,
  createCsrfToken,
  isValidCsrfToken,
  readSessionToken,
  setCsrfCookie,
  setSessionCookie,
  signSession,
  verifyPassword,
  verifySession,
} from '../services/auth.js';
import { completeUpload, createUploadUrl } from '../services/media.js';
import { getSiteConfig } from '../services/siteConfig.js';
import {
  approveTribute,
  getAdminTribute,
  listAdminTributes,
  rejectTribute,
  removeTribute,
  reorderTributes,
  updateTribute,
} from '../services/tributes.js';
import { serializeAdminConfig } from '../serializers/config.js';
import { serializeAdminMedia } from '../serializers/media.js';
import { serializeAdminTributes } from '../serializers/tribute.js';
import { conflict, notFound, unauthorized, unprocessable } from '../utils/errors.js';
import { parseIdParam } from '../utils/objectId.js';
import { pageMeta } from '../utils/pagination.js';
import {
  adminGalleryListQuery,
  adminTributeListQuery,
  adminTributePatch,
  auditListQuery,
  categoriesBody,
  completeUploadBody,
  configPatchBody,
  galleryCreateBody,
  galleryPatchBody,
  loginBody,
  orderBody,
  rejectBody,
  uploadUrlBody,
} from '../validation/schemas.js';

const adminView = (a: Pick<IAdministrator, '_id' | 'email' | 'role' | 'lastLoginAt' | 'createdAt'>) => ({
  id: String(a._id),
  email: a.email,
  role: a.role,
  lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
  createdAt: a.createdAt.toISOString(),
});

// ------------------------------------------------------------------ CSRF

export const issueCsrfToken: RequestHandler = (req, res) => {
  const existing = (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];
  const token = isValidCsrfToken(req.ctx.config, existing) ? existing : createCsrfToken(req.ctx.config);
  setCsrfCookie(req.ctx.config, res, token);
  res.json({ data: { csrfToken: token, headerName: CSRF_HEADER } });
};

// ------------------------------------------------------------------ auth

export const login: RequestHandler = async (req, res) => {
  const { email, password } = parse(loginBody, req.body);
  const admin = await Administrator.findOne({ email }).select('+passwordHash');
  const ok = await verifyPassword(password, admin?.passwordHash);
  if (!admin || !ok || !admin.isActive) {
    req.log.warn({ event: 'admin_login_failed' }, 'Failed admin login');
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  admin.lastLoginAt = new Date();
  await admin.save();
  setSessionCookie(req.ctx.config, res, signSession(req.ctx.config, admin));
  await recordAudit(req, { action: 'admin.login', resourceType: 'admin', resourceId: String(admin._id), summary: 'Administrator logged in' }, admin._id);
  res.json({ data: { admin: adminView(admin) } });
};

export const logout: RequestHandler = async (req, res) => {
  // Logout is allowed without a valid session so a stale cookie can always be cleared.
  const token = readSessionToken(req);
  const claims = token ? verifySession(req.ctx.config, token) : null;
  clearSessionCookie(req.ctx.config, res);
  if (claims && Types.ObjectId.isValid(claims.sub)) {
    await recordAudit(req, { action: 'admin.logout', resourceType: 'admin', resourceId: claims.sub, summary: 'Administrator logged out' }, new Types.ObjectId(claims.sub));
  }
  res.json({ data: { loggedOut: true } });
};

export const me: RequestHandler = (req, res) => {
  const admin = req.admin as IAdministrator;
  res.json({ data: { admin: adminView(admin) } });
};

// ------------------------------------------------------------------ tributes

export const adminListTributes: RequestHandler = async (req, res) => {
  const q = parse(adminTributeListQuery, req.query);
  const { items, total } = await listAdminTributes(q);
  res.json({ data: await serializeAdminTributes(req.ctx, items), meta: pageMeta(q.page, q.limit, total) });
};

export const adminGetTribute: RequestHandler = async (req, res) => {
  const t = await getAdminTribute(parseIdParam(req.params.id, 'Tribute'));
  const [data] = await serializeAdminTributes(req.ctx, [t]);
  res.json({ data });
};

export const adminPatchTribute: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Tribute');
  const patch = parse(adminTributePatch, req.body);
  const config = await getSiteConfig();
  const t = await updateTribute(config, id, patch);
  await recordAudit(req, {
    action: 'tribute.update',
    resourceType: 'tribute',
    resourceId: String(id),
    summary: `Edited tribute fields: ${Object.keys(patch).join(', ')}`,
  });
  const [data] = await serializeAdminTributes(req.ctx, [t]);
  res.json({ data });
};

export const adminApproveTribute: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Tribute');
  const t = await approveTribute(id, (req.admin as IAdministrator)._id);
  await recordAudit(req, { action: 'tribute.approve', resourceType: 'tribute', resourceId: String(id), summary: 'Approved tribute' });
  const [data] = await serializeAdminTributes(req.ctx, [t]);
  res.json({ data });
};

export const adminRejectTribute: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Tribute');
  const { reason } = parse(rejectBody, req.body);
  const t = await rejectTribute(id, (req.admin as IAdministrator)._id, reason);
  await recordAudit(req, { action: 'tribute.reject', resourceType: 'tribute', resourceId: String(id), summary: 'Rejected tribute' });
  const [data] = await serializeAdminTributes(req.ctx, [t]);
  res.json({ data });
};

export const adminRemoveTribute: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Tribute');
  const t = await removeTribute(id, (req.admin as IAdministrator)._id);
  await recordAudit(req, { action: 'tribute.remove', resourceType: 'tribute', resourceId: String(id), summary: 'Removed tribute (soft delete)' });
  const [data] = await serializeAdminTributes(req.ctx, [t]);
  res.json({ data });
};

export const adminOrderTributes: RequestHandler = async (req, res) => {
  const { orderedIds, category } = parse(orderBody, req.body);
  const count = await reorderTributes(orderedIds, category);
  await recordAudit(req, {
    action: 'tribute.reorder',
    resourceType: 'tribute',
    summary: `Reordered ${count} tributes${category ? ` in category ${category}` : ''}`,
  });
  res.json({ data: { updated: count } });
};

// ------------------------------------------------------------------ media + gallery

export const adminUploadUrl: RequestHandler = async (req, res) => {
  const body = parse(uploadUrlBody, req.body);
  const admin = req.admin as IAdministrator;
  const result = await createUploadUrl(req.ctx, { ...body, isPublic: false, uploadedBy: admin._id });
  await recordAudit(req, { action: 'media.upload_url', resourceType: 'media', resourceId: result.mediaId, summary: `Upload URL issued (${body.category})` });
  res.status(201).json({ data: result });
};

export const adminCompleteUpload: RequestHandler = async (req, res) => {
  const body = parse(completeUploadBody, req.body);
  const media = await completeUpload(
    req.ctx,
    parseIdParam(body.mediaId, 'Media'),
    { width: body.width, height: body.height, duration: body.duration },
    { isPublic: false },
  );
  await recordAudit(req, { action: 'media.complete', resourceType: 'media', resourceId: String(media._id), summary: 'Upload verified' });
  res.json({ data: await serializeAdminMedia(req.ctx, media) });
};

const galleryBase = (): QueryFilter<IMedia> => ({
  category: { $in: [...GALLERY_CATEGORIES] },
  uploadStatus: 'uploaded',
});

export const adminListGallery: RequestHandler = async (req, res) => {
  const q = parse(adminGalleryListQuery, req.query);
  const filter = galleryBase();
  if (q.category) filter.category = q.category;
  if (q.visibility) filter.visibility = q.visibility;
  if (!q.includeDeleted) filter.deletedAt = null;
  const [items, total] = await Promise.all([
    Media.find(filter)
      .sort({ displayOrder: 1, createdAt: -1, _id: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<IMedia[]>(),
    Media.countDocuments(filter),
  ]);
  res.json({
    data: await Promise.all(items.map((m) => serializeAdminMedia(req.ctx, m))),
    meta: pageMeta(q.page, q.limit, total),
  });
};

export const adminGetGalleryItem: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Gallery item');
  const item = await Media.findOne({ ...galleryBase(), _id: id }).lean<IMedia>();
  if (!item) throw notFound('Gallery item not found');
  res.json({ data: await serializeAdminMedia(req.ctx, item) });
};

function validateGalleryCategory(media: Pick<IMedia, 'mediaType'>, category: string) {
  if ((media.mediaType === 'video') !== (category === 'gallery_video')) {
    throw unprocessable('Videos must use the gallery_video category and images must not', 'INVALID_GALLERY_CATEGORY');
  }
}

export const adminCreateGalleryItem: RequestHandler = async (req, res) => {
  const body = parse(galleryCreateBody, req.body);
  const media = await Media.findOne({ _id: parseIdParam(body.mediaId, 'Media'), uploadStatus: 'uploaded', deletedAt: null });
  if (!media || media.category.startsWith('tribute_')) {
    throw notFound('Uploaded media not found');
  }
  const category = body.category ?? (media.mediaType === 'video' ? 'gallery_video' : media.category.startsWith('gallery_') ? media.category : 'gallery_family');
  validateGalleryCategory(media, category);

  media.category = category as IMedia['category'];
  media.altText = body.altText;
  if (body.caption !== undefined) media.caption = body.caption;
  media.visibility = body.visibility;
  media.moderationStatus = 'approved';
  if (body.isFeatured !== undefined) media.isFeatured = body.isFeatured;
  if (body.displayOrder !== undefined) {
    media.displayOrder = body.displayOrder;
  } else {
    const top = await Media.findOne({ ...galleryBase(), deletedAt: null }).sort({ displayOrder: -1 }).select('displayOrder').lean();
    media.displayOrder = top ? top.displayOrder + 1 : 0;
  }
  await media.save();
  await recordAudit(req, { action: 'gallery.create', resourceType: 'gallery', resourceId: String(media._id), summary: `Gallery item created (${category}, ${media.visibility})` });
  res.status(201).json({ data: await serializeAdminMedia(req.ctx, media) });
};

export const adminPatchGalleryItem: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Gallery item');
  const patch = parse(galleryPatchBody, req.body);
  const media = await Media.findOne({ ...galleryBase(), _id: id, deletedAt: null });
  if (!media) throw notFound('Gallery item not found');
  if (patch.category) {
    validateGalleryCategory(media, patch.category);
    media.category = patch.category;
  }
  if (patch.altText !== undefined) media.altText = patch.altText;
  if (patch.caption !== undefined) media.caption = patch.caption;
  if (patch.visibility !== undefined) media.visibility = patch.visibility;
  if (patch.isFeatured !== undefined) media.isFeatured = patch.isFeatured;
  if (patch.displayOrder !== undefined) media.displayOrder = patch.displayOrder;
  await media.save();
  await recordAudit(req, { action: 'gallery.update', resourceType: 'gallery', resourceId: String(id), summary: `Updated gallery fields: ${Object.keys(patch).join(', ')}` });
  res.json({ data: await serializeAdminMedia(req.ctx, media) });
};

export const adminDeleteGalleryItem: RequestHandler = async (req, res) => {
  const id = parseIdParam(req.params.id, 'Gallery item');
  const media = await Media.findOneAndUpdate(
    { ...galleryBase(), _id: id, deletedAt: null },
    { $set: { deletedAt: new Date(), deletedBy: (req.admin as IAdministrator)._id, visibility: 'private' } },
    { returnDocument: 'after' },
  ).lean<IMedia>();
  if (!media) throw notFound('Gallery item not found');
  await recordAudit(req, { action: 'gallery.delete', resourceType: 'gallery', resourceId: String(id), summary: 'Gallery item removed (soft delete)' });
  res.json({ data: await serializeAdminMedia(req.ctx, media) });
};

// ------------------------------------------------------------------ config

export const adminGetConfig: RequestHandler = async (_req, res) => {
  res.json({ data: serializeAdminConfig(await getSiteConfig()) });
};

export const adminPatchConfig: RequestHandler = async (req, res) => {
  const patch = parse(configPatchBody, req.body);
  const config = await getSiteConfig();

  if (patch.portraitMediaId) {
    const portrait = await Media.findOne({ _id: patch.portraitMediaId, mediaType: 'image', uploadStatus: 'uploaded', deletedAt: null });
    if (!portrait) throw unprocessable('Portrait must be an uploaded image', 'INVALID_MEDIA', [{ path: 'portraitMediaId', message: 'Image not found' }]);
    portrait.visibility = 'public';
    portrait.moderationStatus = 'approved';
    await portrait.save();
  }
  if (patch.featuredMemories) {
    const count = await Tribute.countDocuments({ _id: { $in: patch.featuredMemories }, status: 'approved', deletedAt: null });
    if (count !== patch.featuredMemories.length) {
      throw unprocessable('Featured memories must be approved tributes', 'INVALID_FEATURED', [{ path: 'featuredMemories', message: 'Contains unknown or unpublished tributes' }]);
    }
  }

  if (patch.memorialTitle !== undefined) config.memorialTitle = patch.memorialTitle;
  if (patch.grandmotherDisplayName !== undefined) config.grandmotherDisplayName = patch.grandmotherDisplayName;
  if (patch.portraitMediaId !== undefined) config.portraitMediaId = patch.portraitMediaId ? new Types.ObjectId(patch.portraitMediaId) : null;
  if (patch.introductoryMessage !== undefined) config.introductoryMessage = patch.introductoryMessage;
  if (patch.closingMessage !== undefined) config.closingMessage = patch.closingMessage;
  if (patch.tributeSubmissionsOpen !== undefined) config.tributeSubmissionsOpen = patch.tributeSubmissionsOpen;
  if (patch.gallery) Object.assign(config.gallery, patch.gallery);
  if (patch.featuredMemories) config.featuredMemories = patch.featuredMemories.map((i) => new Types.ObjectId(i));
  if (patch.publicAcknowledgments) config.publicAcknowledgments = patch.publicAcknowledgments;
  if (patch.privateSettings) {
    config.privateSettings = { ...config.privateSettings, ...patch.privateSettings };
  }
  await config.save();
  await recordAudit(req, { action: 'config.update', resourceType: 'config', summary: `Updated config: ${Object.keys(patch).join(', ')}` });
  res.json({ data: serializeAdminConfig(config) });
};

export const adminPatchCategories: RequestHandler = async (req, res) => {
  const { categories } = parse(categoriesBody, req.body);
  const config = await getSiteConfig();
  const incoming = new Set(categories.map((c) => c.id));
  const dropped = config.relationshipCategories.filter((c) => !incoming.has(c.id)).map((c) => c.id);
  if (dropped.length > 0) {
    throw conflict(`Categories cannot be deleted, only hidden (missing: ${dropped.join(', ')})`, 'CATEGORY_DELETE_FORBIDDEN');
  }
  config.relationshipCategories = categories.map((c, i) => ({ id: c.id, name: c.name, order: c.order ?? i, visible: c.visible }));
  await config.save();
  await recordAudit(req, { action: 'categories.update', resourceType: 'config', summary: `Updated ${categories.length} relationship categories` });
  res.json({ data: { relationshipCategories: serializeAdminConfig(config).relationshipCategories } });
};

// ------------------------------------------------------------------ audit

export const adminListAuditEvents: RequestHandler = async (req, res) => {
  const q = parse(auditListQuery, req.query);
  const filter: Record<string, unknown> = {};
  if (q.action) filter.action = q.action;
  if (q.resourceType) filter.resourceType = q.resourceType;
  if (q.adminId) filter.adminId = new Types.ObjectId(q.adminId);
  const [items, total] = await Promise.all([
    AuditEvent.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    AuditEvent.countDocuments(filter),
  ]);
  res.json({
    data: items.map((e) => ({
      id: String(e._id),
      adminId: String(e.adminId),
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      summary: e.summary,
      correlationId: e.correlationId,
      createdAt: e.createdAt.toISOString(),
    })),
    meta: pageMeta(q.page, q.limit, total),
  });
};