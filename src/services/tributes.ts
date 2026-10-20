import { randomUUID } from 'node:crypto';
import { Types, type QueryFilter } from 'mongoose';
import { CATEGORY_REQUIRING_CUSTOM_TEXT, type TributeStatus } from '../constants.js';
import { Tribute, type ITribute } from '../models/Tribute.js';
import { Media } from '../models/Media.js';
import { SiteConfig, type ISiteConfig } from '../models/SiteConfig.js';
import { conflict, forbidden, notFound, unprocessable, validationError } from '../utils/errors.js';
import { escapeRegex, sha256 } from '../utils/sanitize.js';
import { sortedCategories } from './siteConfig.js';
import type { TributeSubmission } from '../validation/schemas.js';

// ---------------------------------------------------------------- public submit

export interface SubmitResult {
  tribute: ITribute;
  created: boolean;
}

function assertCategory(config: ISiteConfig, id: string, custom: string | null | undefined, requireVisible: boolean) {
  const cat = config.relationshipCategories.find((c) => c.id === id);
  if (!cat || (requireVisible && !cat.visible)) {
    throw validationError([{ path: 'relationshipCategory', message: 'Unknown relationship category' }]);
  }
  if (id === CATEGORY_REQUIRING_CUSTOM_TEXT && !custom) {
    throw validationError([{ path: 'customRelationship', message: 'Please describe your relationship' }]);
  }
}

async function assertSubmitterMedia(
  ids: { contributor?: string | null; grandmother?: string | null },
) {
  const checks: Array<[string | null | undefined, 'tribute_contributor' | 'tribute_grandmother', string]> = [
    [ids.contributor, 'tribute_contributor', 'contributorPhotoMediaId'],
    [ids.grandmother, 'tribute_grandmother', 'grandmotherPhotoMediaId'],
  ];
  for (const [id, category, path] of checks) {
    if (!id) continue;
    const media = await Media.findOne({
      _id: id,
      category,
      uploadStatus: 'uploaded',
      uploadedBy: null,
      deletedAt: null,
    }).lean();
    if (!media) {
      throw unprocessable('Referenced photo is not available. Upload and complete it first.', 'INVALID_MEDIA', [
        { path, message: 'Photo not found or upload not completed' },
      ]);
    }
    const inUse = await Tribute.exists({
      $or: [{ contributorPhotoMediaId: media._id }, { grandmotherPhotoMediaId: media._id }],
    });
    if (inUse) {
      throw unprocessable('Referenced photo is already attached to another tribute', 'INVALID_MEDIA', [
        { path, message: 'Photo already in use' },
      ]);
    }
  }
}

export async function submitTribute(
  config: ISiteConfig,
  body: TributeSubmission,
  headerSubmissionId: string | undefined,
): Promise<SubmitResult> {
  if (!config.tributeSubmissionsOpen) {
    throw forbidden('Tribute submissions are currently closed', 'SUBMISSIONS_CLOSED');
  }
  if (headerSubmissionId && body.submissionId && headerSubmissionId !== body.submissionId) {
    throw validationError([{ path: 'submissionId', message: 'Header and body submissionId do not match' }]);
  }
  const submissionId = headerSubmissionId ?? body.submissionId ?? randomUUID();

  assertCategory(config, body.relationshipCategory, body.customRelationship, true);

  const payloadHash = sha256(
    JSON.stringify([
      body.fullName,
      body.email,
      body.relationshipCategory,
      body.customRelationship ?? '',
      body.tributeText,
      body.contributorPhotoMediaId ?? '',
      body.grandmotherPhotoMediaId ?? '',
      body.photoDisplayPermission,
    ]),
  );

  const existing = await Tribute.findOne({ submissionId }).select('+payloadHash');
  if (existing) return resolveReplay(existing, payloadHash);

  await assertSubmitterMedia({ contributor: body.contributorPhotoMediaId, grandmother: body.grandmotherPhotoMediaId });

  try {
    const tribute = await Tribute.create({
      submissionId,
      payloadHash,
      fullName: body.fullName,
      email: body.email,
      relationshipCategory: body.relationshipCategory,
      customRelationship: body.customRelationship || undefined,
      tributeText: body.tributeText,
      contributorPhotoMediaId: body.contributorPhotoMediaId || null,
      grandmotherPhotoMediaId: body.grandmotherPhotoMediaId || null,
      photoDisplayPermission: body.photoDisplayPermission,
      acknowledgment: true,
      // Status is NEVER taken from the client.
      status: 'pending',
    });
    return { tribute, created: true };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const winner = await Tribute.findOne({ submissionId }).select('+payloadHash');
      if (winner) return resolveReplay(winner, payloadHash);
    }
    throw err;
  }
}

function resolveReplay(existing: ITribute, payloadHash: string): SubmitResult {
  if (existing.payloadHash && existing.payloadHash !== payloadHash) {
    throw conflict('This submissionId was already used with different content', 'IDEMPOTENCY_CONFLICT');
  }
  return { tribute: existing, created: false };
}

// ---------------------------------------------------------------- public read

export async function listPublicTributes(
  config: ISiteConfig,
  q: { page: number; limit: number; category?: string; featured?: boolean },
) {
  const match: QueryFilter<ITribute> = { status: 'approved', deletedAt: null };
  if (q.category) match.relationshipCategory = q.category;
  if (q.featured) match.isFeatured = true;

  const orderedIds = sortedCategories(config).map((c) => c.id);

  const [items, total] = await Promise.all([
    Tribute.aggregate<ITribute>([
      { $match: match },
      {
        $addFields: {
          _rank: {
            $let: {
              vars: { i: { $indexOfArray: [orderedIds, '$relationshipCategory'] } },
              in: { $cond: [{ $lt: ['$$i', 0] }, 9999, '$$i'] },
            },
          },
        },
      },
      { $sort: { _rank: 1, displayOrder: 1, publishedAt: 1, _id: 1 } },
      { $skip: (q.page - 1) * q.limit },
      { $limit: q.limit },
      // Defence in depth: private fields never leave the database layer for public reads.
      { $project: { email: 0, payloadHash: 0, moderationNotes: 0, _rank: 0 } },
    ]),
    Tribute.countDocuments(match),
  ]);
  return { items, total };
}

export async function getPublicTribute(id: Types.ObjectId): Promise<ITribute> {
  const t = await Tribute.findOne({ _id: id, status: 'approved', deletedAt: null })
    .select('-email -payloadHash -moderationNotes')
    .lean<ITribute>();
  if (!t) throw notFound('Tribute not found');
  return t;
}

// ---------------------------------------------------------------- admin

export async function listAdminTributes(q: {
  page: number;
  limit: number;
  status?: TributeStatus;
  category?: string;
  q?: string;
  includeDeleted?: boolean;
}) {
  const filter: QueryFilter<ITribute> = {};
  if (q.status) filter.status = q.status;
  if (q.category) filter.relationshipCategory = q.category;
  if (!q.includeDeleted && q.status !== 'removed') filter.deletedAt = null;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { tributeText: rx }];
  }
  const [items, total] = await Promise.all([
    Tribute.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<ITribute[]>(),
    Tribute.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getAdminTribute(id: Types.ObjectId, includeDeleted = true): Promise<ITribute> {
  const t = await Tribute.findOne(includeDeleted ? { _id: id } : { _id: id, deletedAt: null }).lean<ITribute>();
  if (!t) throw notFound('Tribute not found');
  return t;
}

async function nextDisplayOrder(category: string): Promise<number> {
  const top = await Tribute.findOne({ status: 'approved', deletedAt: null, relationshipCategory: category })
    .sort({ displayOrder: -1 })
    .select('displayOrder')
    .lean();
  return top ? top.displayOrder + 1 : 0;
}

/** Keep attached photo visibility consistent with the tribute's publication state. */
async function syncTributeMedia(t: Pick<ITribute, 'status' | 'photoDisplayPermission' | 'contributorPhotoMediaId' | 'grandmotherPhotoMediaId'>) {
  const ids = [t.contributorPhotoMediaId, t.grandmotherPhotoMediaId].filter(Boolean) as Types.ObjectId[];
  if (ids.length === 0) return;
  if (t.status === 'approved' && t.photoDisplayPermission) {
    await Media.updateMany({ _id: { $in: ids } }, { $set: { visibility: 'public', moderationStatus: 'approved' } });
  } else {
    const moderationStatus = t.status === 'approved' ? 'approved' : t.status === 'pending' ? 'pending' : 'rejected';
    await Media.updateMany({ _id: { $in: ids } }, { $set: { visibility: 'private', moderationStatus } });
  }
}

export async function updateTribute(
  config: ISiteConfig,
  id: Types.ObjectId,
  patch: {
    fullName?: string;
    tributeText?: string;
    relationshipCategory?: string;
    customRelationship?: string | null;
    photoDisplayPermission?: boolean;
    isFeatured?: boolean;
    moderationNotes?: string;
    displayOrder?: number;
  },
): Promise<ITribute> {
  const t = await Tribute.findOne({ _id: id, deletedAt: null });
  if (!t) throw notFound('Tribute not found');

  const category = patch.relationshipCategory ?? t.relationshipCategory;
  const custom = patch.customRelationship === undefined ? t.customRelationship : patch.customRelationship;
  if (patch.relationshipCategory !== undefined || patch.customRelationship !== undefined) {
    assertCategory(config, category, custom, false);
  }

  const categoryChanged = category !== t.relationshipCategory;
  if (patch.fullName !== undefined) t.fullName = patch.fullName;
  if (patch.tributeText !== undefined) t.tributeText = patch.tributeText;
  if (patch.relationshipCategory !== undefined) t.relationshipCategory = patch.relationshipCategory;
  if (patch.customRelationship !== undefined) t.customRelationship = patch.customRelationship ?? undefined;
  if (patch.photoDisplayPermission !== undefined) t.photoDisplayPermission = patch.photoDisplayPermission;
  if (patch.isFeatured !== undefined) t.isFeatured = patch.isFeatured;
  if (patch.moderationNotes !== undefined) t.moderationNotes = patch.moderationNotes;
  if (patch.displayOrder !== undefined) t.displayOrder = patch.displayOrder;
  else if (categoryChanged && t.status === 'approved') t.displayOrder = await nextDisplayOrder(category);

  const contentChanged =
    patch.fullName !== undefined ||
    patch.tributeText !== undefined ||
    patch.relationshipCategory !== undefined ||
    patch.customRelationship !== undefined;
  if (contentChanged) t.editedAt = new Date();

  await t.save();
  if (patch.photoDisplayPermission !== undefined) await syncTributeMedia(t);
  return t.toObject();
}

async function transition(
  id: Types.ObjectId,
  allowedFrom: TributeStatus[],
  action: string,
  update: (t: ITribute) => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<ITribute> {
  const current = await Tribute.findOne({ _id: id, deletedAt: null }).lean<ITribute>();
  if (!current) throw notFound('Tribute not found');
  if (!allowedFrom.includes(current.status)) {
    throw conflict(`Cannot ${action} a tribute that is ${current.status}`, 'INVALID_STATUS_TRANSITION');
  }
  const updated = await Tribute.findOneAndUpdate(
    { _id: id, deletedAt: null, status: current.status },
    await update(current),
    { returnDocument: 'after' },
  ).lean<ITribute>();
  if (!updated) throw conflict('The tribute was modified concurrently; please retry', 'INVALID_STATUS_TRANSITION');
  await syncTributeMedia(updated);
  return updated;
}

export function approveTribute(id: Types.ObjectId, adminId: Types.ObjectId): Promise<ITribute> {
  return transition(id, ['pending', 'rejected'], 'approve', async (t) => {
    const now = new Date();
    return {
      $set: {
        status: 'approved',
        approvedAt: now,
        approvedBy: adminId,
        publishedAt: t.publishedAt ?? now,
        rejectedAt: null,
        rejectedBy: null,
        displayOrder: await nextDisplayOrder(t.relationshipCategory),
      },
    };
  });
}

export function rejectTribute(id: Types.ObjectId, adminId: Types.ObjectId, reason?: string): Promise<ITribute> {
  return transition(id, ['pending', 'approved'], 'reject', () => ({
    $set: {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectedBy: adminId,
      approvedAt: null,
      approvedBy: null,
      publishedAt: null,
      isFeatured: false,
      ...(reason ? { moderationNotes: reason } : {}),
    },
  }));
}

export async function removeTribute(id: Types.ObjectId, adminId: Types.ObjectId): Promise<ITribute> {
  const removed = await transition(id, ['pending', 'approved', 'rejected'], 'remove', () => ({
    $set: { status: 'removed', deletedAt: new Date(), deletedBy: adminId, isFeatured: false },
  }));
  await SiteConfig.updateOne({ key: 'default' }, { $pull: { featuredMemories: removed._id } });
  return removed;
}

/**
 * Set display order for approved tributes. Each tribute receives its index within its own
 * relationship category, following the order of `orderedIds`.
 */
export async function reorderTributes(orderedIds: string[], category?: string): Promise<number> {
  const objectIds = orderedIds.map((i) => new Types.ObjectId(i));
  const docs = await Tribute.find({ _id: { $in: objectIds }, status: 'approved', deletedAt: null })
    .select('relationshipCategory')
    .lean();
  if (docs.length !== objectIds.length) {
    throw unprocessable('All ids must refer to approved, non-deleted tributes', 'INVALID_ORDER_IDS');
  }
  const catById = new Map(docs.map((d) => [String(d._id), d.relationshipCategory]));
  if (category && [...catById.values()].some((c) => c !== category)) {
    throw unprocessable(`All tributes must be in category "${category}"`, 'INVALID_ORDER_IDS');
  }
  const counters = new Map<string, number>();
  const ops = orderedIds.map((id) => {
    const cat = catById.get(id) as string;
    const next = counters.get(cat) ?? 0;
    counters.set(cat, next + 1);
    return { updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { displayOrder: next } } } };
  });
  await Tribute.bulkWrite(ops);
  return ops.length;
}
