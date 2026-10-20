import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { fileTypeFromBuffer } from 'file-type';
import { Types } from 'mongoose';
import type { AppContext } from '../context.js';
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  PUBLIC_UPLOAD_CATEGORIES,
  type MediaCategory,
  type MediaType,
} from '../constants.js';
import { Media, type IMedia } from '../models/Media.js';
import { serviceUnavailable, unprocessable, notFound, forbidden } from '../utils/errors.js';

const SNIFF_BYTES = 4100;
const UPLOAD_TOKEN_AUDIENCE = 'hom-media-complete';

// Detected (magic byte) MIME types accepted for each declared MIME type.
const EQUIVALENT_TYPES: Record<string, string[]> = {
  'image/jpeg': ['image/jpeg'],
  'image/png': ['image/png'],
  'image/webp': ['image/webp'],
  'image/avif': ['image/avif'],
  'video/mp4': ['video/mp4', 'video/x-m4v'],
  'video/webm': ['video/webm'],
  'video/quicktime': ['video/quicktime'],
};

export function mediaTypeFromMime(mime: string): MediaType | null {
  if (mime in ALLOWED_IMAGE_TYPES) return 'image';
  if (mime in ALLOWED_VIDEO_TYPES) return 'video';
  return null;
}

export function extensionFor(mime: string): string {
  return ALLOWED_IMAGE_TYPES[mime] ?? ALLOWED_VIDEO_TYPES[mime] ?? 'bin';
}

export function requireStorage(ctx: AppContext): void {
  if (!ctx.storage.isConfigured()) {
    throw serviceUnavailable(
      'Media storage is not configured on this server. Set the R2_* environment variables.',
      'STORAGE_NOT_CONFIGURED',
    );
  }
}

function keyPrefix(category: MediaCategory): string {
  if (category.startsWith('tribute_')) return 'tributes';
  if (category.startsWith('gallery_')) return 'gallery';
  return 'misc';
}

export interface UploadUrlInput {
  contentType: string;
  fileSize: number;
  category: MediaCategory;
  altText?: string;
  caption?: string;
  uploadedBy?: Types.ObjectId | null;
  /** Public (unauthenticated) callers are restricted to tribute photos. */
  isPublic: boolean;
}

export async function createUploadUrl(ctx: AppContext, input: UploadUrlInput) {
  requireStorage(ctx);
  const { config } = ctx;

  if (input.isPublic && !(PUBLIC_UPLOAD_CATEGORIES as readonly string[]).includes(input.category)) {
    throw forbidden('This upload category is not available for public submissions', 'UPLOAD_CATEGORY_FORBIDDEN');
  }
  const mediaType = mediaTypeFromMime(input.contentType);
  if (!mediaType) {
    throw unprocessable('Unsupported file type', 'UNSUPPORTED_MEDIA_TYPE', [
      { path: 'contentType', message: `Allowed: ${[...Object.keys(ALLOWED_IMAGE_TYPES), ...Object.keys(ALLOWED_VIDEO_TYPES)].join(', ')}` },
    ]);
  }
  if (input.isPublic && mediaType !== 'image') {
    throw unprocessable('Only image uploads are allowed for tribute submissions', 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (input.category === 'gallery_video' && mediaType !== 'video') {
    throw unprocessable('gallery_video uploads must be videos', 'UNSUPPORTED_MEDIA_TYPE');
  }
  if (input.category !== 'gallery_video' && input.category !== 'other' && mediaType !== 'image') {
    throw unprocessable('This category only accepts images', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const maxBytes = mediaType === 'image' ? config.maxImageBytes : config.maxVideoBytes;
  if (input.fileSize <= 0 || input.fileSize > maxBytes) {
    throw unprocessable(`File size must be between 1 byte and ${maxBytes} bytes`, 'FILE_TOO_LARGE', [
      { path: 'fileSize', message: `Maximum allowed is ${maxBytes} bytes` },
    ]);
  }

  const now = new Date();
  const storageKey = `${keyPrefix(input.category)}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${extensionFor(input.contentType)}`;
  const expiresIn = config.uploadUrlTtlSeconds;

  const upload = await ctx.storage.createUploadUrl({
    key: storageKey,
    contentType: input.contentType,
    contentLength: input.fileSize,
    expiresIn,
  });

  const media = await Media.create({
    storageKey,
    mediaType,
    mimeType: input.contentType,
    fileSize: input.fileSize,
    altText: input.altText,
    caption: input.caption,
    visibility: 'private',
    moderationStatus: input.isPublic ? 'pending' : 'approved',
    category: input.category,
    uploadStatus: 'awaiting_upload',
    // keep the record a little longer than the URL so late completes still work
    pendingExpiresAt: new Date(now.getTime() + (expiresIn + 3600) * 1000),
    uploadedBy: input.uploadedBy ?? null,
  });

  const result: {
    mediaId: string;
    upload: typeof upload;
    expiresInSeconds: number;
    maxBytes: number;
    completionToken?: string;
  } = { mediaId: String(media._id), upload, expiresInSeconds: expiresIn, maxBytes };

  if (input.isPublic) {
    result.completionToken = jwt.sign({}, ctx.config.jwtSecret, {
      subject: String(media._id),
      audience: UPLOAD_TOKEN_AUDIENCE,
      expiresIn: expiresIn + 3600,
    });
  }
  return result;
}

export function verifyCompletionToken(ctx: AppContext, token: string | undefined, mediaId: string): void {
  if (!token) throw forbidden('A completion token is required', 'COMPLETION_TOKEN_REQUIRED');
  try {
    const payload = jwt.verify(token, ctx.config.jwtSecret, { audience: UPLOAD_TOKEN_AUDIENCE, algorithms: ['HS256'] });
    if (typeof payload === 'string' || payload.sub !== mediaId) throw new Error('mismatch');
  } catch {
    throw forbidden('Invalid or expired completion token', 'COMPLETION_TOKEN_INVALID');
  }
}

export interface CompleteInput {
  width?: number;
  height?: number;
  duration?: number;
}

async function discard(ctx: AppContext, media: IMedia): Promise<void> {
  try {
    await ctx.storage.deleteObject(media.storageKey);
  } catch (err) {
    ctx.logger.warn({ err, mediaId: String(media._id) }, 'Failed to delete rejected upload object');
  }
  await Media.deleteOne({ _id: media._id });
}

/** Verify the uploaded object (exists, size, magic bytes) and mark the media as uploaded. */
export async function completeUpload(
  ctx: AppContext,
  mediaId: Types.ObjectId,
  extra: CompleteInput,
  opts: { isPublic: boolean },
): Promise<IMedia> {
  requireStorage(ctx);
  const media = await Media.findOne({ _id: mediaId, deletedAt: null });
  if (!media) throw notFound('Media not found');
  if (opts.isPublic && !(PUBLIC_UPLOAD_CATEGORIES as readonly string[]).includes(media.category)) {
    throw notFound('Media not found');
  }
  if (media.uploadStatus === 'uploaded') return media; // idempotent

  const head = await ctx.storage.headObject(media.storageKey);
  if (!head) {
    throw unprocessable('The file has not been uploaded yet', 'UPLOAD_NOT_FOUND');
  }
  const maxBytes = media.mediaType === 'image' ? ctx.config.maxImageBytes : ctx.config.maxVideoBytes;
  if (head.size <= 0 || head.size > maxBytes || head.size !== media.fileSize) {
    await discard(ctx, media);
    throw unprocessable('Uploaded file size does not match what was declared', 'FILE_SIZE_MISMATCH');
  }

  const bytes = await ctx.storage.getObjectBytes(media.storageKey, 0, Math.min(SNIFF_BYTES, head.size) - 1);
  const detected = bytes ? await fileTypeFromBuffer(bytes) : undefined;
  const acceptable = EQUIVALENT_TYPES[media.mimeType] ?? [];
  if (!detected || !acceptable.includes(detected.mime)) {
    await discard(ctx, media);
    throw unprocessable('The uploaded file content does not match its declared type', 'INVALID_FILE_CONTENT');
  }

  media.uploadStatus = 'uploaded';
  media.uploadedAt = new Date();
  media.pendingExpiresAt = null;
  if (extra.width !== undefined) media.width = extra.width;
  if (extra.height !== undefined) media.height = extra.height;
  if (extra.duration !== undefined && media.mediaType === 'video') media.duration = extra.duration;
  await media.save();
  return media;
}

/** Best-effort URL for delivering a media object. */
export async function resolveMediaUrl(ctx: AppContext, media: Pick<IMedia, 'storageKey' | 'visibility'>): Promise<string | null> {
  if (media.visibility === 'public') {
    const pub = ctx.storage.publicUrl(media.storageKey);
    if (pub) return pub;
  }
  if (!ctx.storage.isConfigured()) return null;
  try {
    return await ctx.storage.getDownloadUrl(media.storageKey, 3600);
  } catch (err) {
    ctx.logger.warn({ err }, 'Failed to create download URL');
    return null;
  }
}

export async function loadMediaMap(ids: Array<Types.ObjectId | string | null | undefined>): Promise<Map<string, IMedia>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const docs = await Media.find({ _id: { $in: unique.map((i) => new Types.ObjectId(i)) }, deletedAt: null }).lean<IMedia[]>();
  return new Map(docs.map((d) => [String(d._id), d]));
}

/** Is this media safe to expose publicly? */
export function isPubliclyVisible(media: IMedia | undefined | null): media is IMedia {
  return Boolean(
    media &&
      media.visibility === 'public' &&
      media.moderationStatus === 'approved' &&
      media.uploadStatus === 'uploaded' &&
      !media.deletedAt,
  );
}