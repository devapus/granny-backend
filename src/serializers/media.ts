import type { AppContext } from '../context.js';
import type { IMedia } from '../models/Media.js';
import { resolveMediaUrl } from '../services/media.js';

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

/** Public gallery item: no storage keys, uploader or moderation data. */
export async function serializePublicGalleryItem(ctx: AppContext, m: IMedia) {
  return {
    id: String(m._id),
    mediaType: m.mediaType,
    category: m.category,
    url: await resolveMediaUrl(ctx, m),
    altText: m.altText ?? '',
    caption: m.caption ?? '',
    width: m.width ?? null,
    height: m.height ?? null,
    duration: m.duration ?? null,
    isFeatured: m.isFeatured,
  };
}

/** Embedded photo on a public tribute / config portrait. */
export async function serializePublicPhoto(ctx: AppContext, m: IMedia) {
  return {
    id: String(m._id),
    url: await resolveMediaUrl(ctx, m),
    altText: m.altText ?? '',
    width: m.width ?? null,
    height: m.height ?? null,
  };
}

export async function serializeAdminMedia(ctx: AppContext, m: IMedia) {
  return {
    id: String(m._id),
    storageKey: m.storageKey,
    mediaType: m.mediaType,
    mimeType: m.mimeType,
    fileSize: m.fileSize,
    width: m.width ?? null,
    height: m.height ?? null,
    duration: m.duration ?? null,
    altText: m.altText ?? '',
    caption: m.caption ?? '',
    visibility: m.visibility,
    moderationStatus: m.moderationStatus,
    category: m.category,
    uploadStatus: m.uploadStatus,
    displayOrder: m.displayOrder,
    isFeatured: m.isFeatured,
    uploadedAt: iso(m.uploadedAt),
    uploadedBy: m.uploadedBy ? String(m.uploadedBy) : null,
    deletedAt: iso(m.deletedAt),
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
    url: m.uploadStatus === 'uploaded' ? await resolveMediaUrl(ctx, m) : null,
  };
}
