import { z } from 'zod';
import {
  CUSTOM_RELATIONSHIP_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  GALLERY_CATEGORIES,
  MEDIA_CATEGORIES,
  MEDIA_TYPES,
  MEDIA_VISIBILITIES,
  TRIBUTE_MAX_LENGTH,
  TRIBUTE_MIN_LENGTH,
  TRIBUTE_STATUSES,
} from '../constants.js';
import { objectIdSchema } from '../utils/objectId.js';
import { paginationQuery } from '../utils/pagination.js';
import { sanitizeText } from '../utils/sanitize.js';

// ---------- helpers ----------
const cleanLine = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((s) => sanitizeText(s))
    .pipe(z.string().min(min, `${label} is required`).max(max, `${label} must be at most ${max} characters`));

const cleanOptionalLine = (max: number) =>
  z
    .string()
    .transform((s) => sanitizeText(s))
    .pipe(z.string().max(max, `Must be at most ${max} characters`));

const cleanBlock = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((s) => sanitizeText(s, { multiline: true }))
    .pipe(
      z
        .string()
        .min(min, `${label} must be at least ${min} characters`)
        .max(max, `${label} must be at most ${max} characters`),
    );

const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Email must be a valid email address').max(254));

const relationshipId = z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'Invalid relationship category');

// ---------- public ----------
export const submissionIdSchema = z.string().uuid('submissionId must be a UUID');

export const tributeSubmissionSchema = z.object({
  submissionId: submissionIdSchema.optional(),
  fullName: cleanLine(1, FULL_NAME_MAX_LENGTH, 'Full name'),
  email: emailSchema,
  relationshipCategory: relationshipId,
  customRelationship: cleanOptionalLine(CUSTOM_RELATIONSHIP_MAX_LENGTH).optional(),
  tributeText: cleanBlock(TRIBUTE_MIN_LENGTH, TRIBUTE_MAX_LENGTH, 'Tribute'),
  contributorPhotoMediaId: objectIdSchema.nullish(),
  grandmotherPhotoMediaId: objectIdSchema.nullish(),
  photoDisplayPermission: z.boolean().default(false),
  acknowledgment: z.literal(true, { error: 'You must acknowledge the terms to submit a tribute' }),
});
export type TributeSubmission = z.infer<typeof tributeSubmissionSchema>;

export const publicTributeListQuery = paginationQuery(20, 50).extend({
  category: relationshipId.optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const publicGalleryListQuery = paginationQuery(24, 100).extend({
  category: z.enum(GALLERY_CATEGORIES).optional(),
  mediaType: z.enum(MEDIA_TYPES).optional(),
});

export const uploadUrlBody = z.object({
  contentType: z.string().trim().toLowerCase().max(100),
  fileSize: z.number().int().positive(),
  category: z.enum(MEDIA_CATEGORIES),
  altText: cleanOptionalLine(500).optional(),
  caption: cleanOptionalLine(1000).optional(),
});

export const completeUploadBody = z.object({
  mediaId: objectIdSchema,
  completionToken: z.string().max(2000).optional(),
  width: z.number().int().min(0).max(100_000).optional(),
  height: z.number().int().min(0).max(100_000).optional(),
  duration: z.number().min(0).max(86_400).optional(),
});

// ---------- admin ----------
export const loginBody = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});

export const adminTributeListQuery = paginationQuery(20, 100).extend({
  status: z.enum(TRIBUTE_STATUSES).optional(),
  category: relationshipId.optional(),
  q: z.string().trim().max(100).optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const adminTributePatch = z
  .object({
    fullName: cleanLine(1, FULL_NAME_MAX_LENGTH, 'Full name'),
    tributeText: cleanBlock(TRIBUTE_MIN_LENGTH, TRIBUTE_MAX_LENGTH, 'Tribute'),
    relationshipCategory: relationshipId,
    customRelationship: cleanOptionalLine(CUSTOM_RELATIONSHIP_MAX_LENGTH).nullable(),
    photoDisplayPermission: z.boolean(),
    isFeatured: z.boolean(),
    moderationNotes: cleanBlock(0, 2000, 'Moderation notes'),
    displayOrder: z.number().int().min(0).max(1_000_000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field must be provided');

export const rejectBody = z.object({ reason: cleanBlock(0, 2000, 'Reason').optional() });

export const orderBody = z.object({
  category: relationshipId.optional(),
  orderedIds: z
    .array(objectIdSchema)
    .min(1)
    .max(1000)
    .refine((a) => new Set(a).size === a.length, 'orderedIds must be unique'),
});

export const galleryCreateBody = z.object({
  mediaId: objectIdSchema,
  altText: cleanLine(1, 500, 'Alt text'),
  caption: cleanOptionalLine(1000).optional(),
  category: z.enum(GALLERY_CATEGORIES).optional(),
  visibility: z.enum(MEDIA_VISIBILITIES).default('public'),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const galleryPatchBody = z
  .object({
    altText: cleanLine(1, 500, 'Alt text'),
    caption: cleanOptionalLine(1000),
    category: z.enum(GALLERY_CATEGORIES),
    visibility: z.enum(MEDIA_VISIBILITIES),
    isFeatured: z.boolean(),
    displayOrder: z.number().int().min(0).max(1_000_000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field must be provided');

export const adminGalleryListQuery = paginationQuery(24, 100).extend({
  category: z.enum(GALLERY_CATEGORIES).optional(),
  visibility: z.enum(MEDIA_VISIBILITIES).optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const categoriesBody = z.object({
  categories: z
    .array(
      z.object({
        id: relationshipId,
        name: cleanLine(1, 60, 'Category name'),
        order: z.number().int().min(0).max(1000).optional(),
        visible: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(40)
    .refine((a) => new Set(a.map((c) => c.id)).size === a.length, 'Category ids must be unique'),
});

export const configPatchBody = z
  .object({
    memorialTitle: cleanLine(1, 120, 'Memorial title'),
    grandmotherDisplayName: cleanLine(1, 120, 'Display name'),
    portraitMediaId: objectIdSchema.nullable(),
    introductoryMessage: cleanBlock(1, 2000, 'Introductory message'),
    closingMessage: cleanBlock(1, 2000, 'Closing message'),
    tributeSubmissionsOpen: z.boolean(),
    gallery: z
      .object({
        enabled: z.boolean(),
        itemsPerPage: z.number().int().min(1).max(100),
        allowVideos: z.boolean(),
        layout: z.enum(['grid', 'masonry']),
      })
      .partial(),
    featuredMemories: z.array(objectIdSchema).max(12).refine((a) => new Set(a).size === a.length, 'Must be unique'),
    publicAcknowledgments: z
      .array(
        z.object({
          id: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/),
          name: cleanLine(1, 120, 'Name'),
          message: cleanOptionalLine(1000).default(''),
          order: z.number().int().min(0).max(1000).default(0),
          visible: z.boolean().default(true),
        }),
      )
      .max(100),
    privateSettings: z
      .object({
        notificationEmail: z.union([emailSchema, z.literal('')]),
        moderationGuidelines: z.string().max(4000),
        internalNotes: z.string().max(4000),
      })
      .partial(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field must be provided');

export const auditListQuery = paginationQuery(50, 200).extend({
  action: z.string().trim().max(80).optional(),
  resourceType: z.string().trim().max(40).optional(),
  adminId: objectIdSchema.optional(),
});
