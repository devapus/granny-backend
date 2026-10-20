import type { AppContext } from '../context.js';
import type { ITribute } from '../models/Tribute.js';
import type { IMedia } from '../models/Media.js';
import type { ISiteConfig } from '../models/SiteConfig.js';
import { isPubliclyVisible, loadMediaMap } from '../services/media.js';
import { serializePublicPhoto, serializeAdminMedia } from './media.js';

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

function categoryName(config: Pick<ISiteConfig, 'relationshipCategories'>, id: string): string {
  return config.relationshipCategories.find((c) => c.id === id)?.name ?? id;
}

/**
 * PUBLIC tribute shape. This is an explicit allow-list: email, submissionId, moderation fields,
 * audit/admin ids and status are never included.
 */
export async function serializePublicTributes(
  ctx: AppContext,
  tributes: ITribute[],
  config: Pick<ISiteConfig, 'relationshipCategories'>,
) {
  const mediaIds = tributes.flatMap((t) =>
    t.photoDisplayPermission ? [t.contributorPhotoMediaId, t.grandmotherPhotoMediaId] : [],
  );
  const mediaMap = await loadMediaMap(mediaIds);

  const photo = async (id: ITribute['contributorPhotoMediaId'], allowed: boolean) => {
    if (!allowed || !id) return null;
    const m = mediaMap.get(String(id));
    return isPubliclyVisible(m) ? serializePublicPhoto(ctx, m) : null;
  };

  return Promise.all(
    tributes.map(async (t) => ({
      id: String(t._id),
      fullName: t.fullName,
      relationshipCategory: t.relationshipCategory,
      relationshipLabel: t.customRelationship || categoryName(config, t.relationshipCategory),
      customRelationship: t.customRelationship ?? null,
      tributeText: t.tributeText,
      contributorPhoto: await photo(t.contributorPhotoMediaId, t.photoDisplayPermission),
      grandmotherPhoto: await photo(t.grandmotherPhotoMediaId, t.photoDisplayPermission),
      isFeatured: t.isFeatured,
      publishedAt: iso(t.publishedAt),
    })),
  );
}

/** Minimal receipt returned to the submitter. Contains no email and no other user data. */
export function serializeSubmissionReceipt(t: Pick<ITribute, '_id' | 'submissionId' | 'status' | 'createdAt'>) {
  return {
    id: String(t._id),
    submissionId: t.submissionId,
    status: t.status,
    createdAt: iso(t.createdAt),
    message: 'Thank you. Your tribute has been received and will appear once it has been reviewed.',
  };
}

export async function serializeAdminTributes(ctx: AppContext, tributes: ITribute[]) {
  const mediaMap = await loadMediaMap(
    tributes.flatMap((t) => [t.contributorPhotoMediaId, t.grandmotherPhotoMediaId]),
  );
  const media = async (id: ITribute['contributorPhotoMediaId']) => {
    if (!id) return null;
    const m: IMedia | undefined = mediaMap.get(String(id));
    return m ? serializeAdminMedia(ctx, m) : null;
  };
  return Promise.all(
    tributes.map(async (t) => ({
      id: String(t._id),
      submissionId: t.submissionId,
      fullName: t.fullName,
      email: t.email,
      relationshipCategory: t.relationshipCategory,
      customRelationship: t.customRelationship ?? null,
      tributeText: t.tributeText,
      contributorPhotoMediaId: t.contributorPhotoMediaId ? String(t.contributorPhotoMediaId) : null,
      grandmotherPhotoMediaId: t.grandmotherPhotoMediaId ? String(t.grandmotherPhotoMediaId) : null,
      contributorPhoto: await media(t.contributorPhotoMediaId),
      grandmotherPhoto: await media(t.grandmotherPhotoMediaId),
      photoDisplayPermission: t.photoDisplayPermission,
      acknowledgment: t.acknowledgment,
      status: t.status,
      displayOrder: t.displayOrder,
      isFeatured: t.isFeatured,
      moderationNotes: t.moderationNotes ?? '',
      approvedAt: iso(t.approvedAt),
      approvedBy: t.approvedBy ? String(t.approvedBy) : null,
      rejectedAt: iso(t.rejectedAt),
      rejectedBy: t.rejectedBy ? String(t.rejectedBy) : null,
      publishedAt: iso(t.publishedAt),
      editedAt: iso(t.editedAt),
      deletedAt: iso(t.deletedAt),
      deletedBy: t.deletedBy ? String(t.deletedBy) : null,
      createdAt: iso(t.createdAt),
      updatedAt: iso(t.updatedAt),
    })),
  );
}
