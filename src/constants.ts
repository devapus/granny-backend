export const API_PREFIX = '/api/v1';

export const TRIBUTE_MIN_LENGTH = 20;
export const TRIBUTE_MAX_LENGTH = 5000;
export const FULL_NAME_MAX_LENGTH = 120;
export const CUSTOM_RELATIONSHIP_MAX_LENGTH = 100;

export const DEFAULT_MEMORIAL_TITLE = 'House of Memories';
export const DEFAULT_GRANDMOTHER_NAME = 'Sarah Abeke Ibrahim';
export const DEFAULT_INTRODUCTORY_MESSAGE =
  'Though I may no longer be here beside you, the love we shared lives on in every memory. Step inside and discover the beautiful things my family and friends remember about me.';
export const DEFAULT_CLOSING_MESSAGE =
  'Thank you for taking the time to remember her with us. Every story, every photograph and every kind word keeps her spirit close to those who loved her. May these memories bring comfort today and in the days ahead.';

export const DEFAULT_CATEGORIES: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'children', name: 'Children' },
  { id: 'grandchildren', name: 'Grandchildren' },
  { id: 'siblings', name: 'Siblings' },
  { id: 'other_family', name: 'Other Family' },
  { id: 'friends', name: 'Friends' },
  { id: 'neighbors', name: 'Neighbors' },
  { id: 'community', name: 'Community' },
  { id: 'other', name: 'Other' },
];

/** Category whose tributes must include a free-text relationship. */
export const CATEGORY_REQUIRING_CUSTOM_TEXT = 'other';

export const TRIBUTE_STATUSES = ['pending', 'approved', 'rejected', 'removed'] as const;
export type TributeStatus = (typeof TRIBUTE_STATUSES)[number];

export const MEDIA_TYPES = ['image', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_CATEGORIES = [
  'tribute_contributor',
  'tribute_grandmother',
  'gallery_family',
  'gallery_featured',
  'gallery_video',
  'other',
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const PUBLIC_UPLOAD_CATEGORIES = ['tribute_contributor', 'tribute_grandmother'] as const;
export const GALLERY_CATEGORIES = ['gallery_family', 'gallery_featured', 'gallery_video'] as const;

export const MEDIA_VISIBILITIES = ['public', 'private'] as const;
export const MODERATION_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** Allowed uploads. Value = canonical file extension. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
export const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export const SESSION_COOKIE = 'hom_session';
export const CSRF_COOKIE = 'hom_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CORRELATION_HEADER = 'x-correlation-id';
