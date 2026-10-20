import type { AppContext } from '../context.js';
import type { ISiteConfig } from '../models/SiteConfig.js';
import { Media, type IMedia } from '../models/Media.js';
import { Tribute, type ITribute } from '../models/Tribute.js';
import { isPubliclyVisible } from '../services/media.js';
import { sortedCategories } from '../services/siteConfig.js';
import { TRIBUTE_MAX_LENGTH, TRIBUTE_MIN_LENGTH } from '../constants.js';
import { serializePublicPhoto } from './media.js';
import { serializePublicTributes } from './tribute.js';

/** PUBLIC config. privateSettings are never included. */
export async function serializePublicConfig(ctx: AppContext, c: ISiteConfig) {
  let portrait: IMedia | null = null;
  if (c.portraitMediaId) {
    portrait = await Media.findOne({ _id: c.portraitMediaId, deletedAt: null }).lean<IMedia>();
  }
  let featured: ITribute[] = [];
  if (c.featuredMemories.length > 0) {
    const found = await Tribute.find({
      _id: { $in: c.featuredMemories },
      status: 'approved',
      deletedAt: null,
    }).lean<ITribute[]>();
    const byId = new Map(found.map((t) => [String(t._id), t]));
    featured = c.featuredMemories.map((id) => byId.get(String(id))).filter((t): t is ITribute => Boolean(t));
  }

  return {
    memorialTitle: c.memorialTitle,
    grandmotherDisplayName: c.grandmotherDisplayName,
    portrait: isPubliclyVisible(portrait) ? await serializePublicPhoto(ctx, portrait) : null,
    introductoryMessage: c.introductoryMessage,
    closingMessage: c.closingMessage,
    tributeSubmissionsOpen: c.tributeSubmissionsOpen,
    relationshipCategories: sortedCategories(c)
      .filter((x) => x.visible)
      .map((x) => ({ id: x.id, name: x.name, order: x.order })),
    gallery: {
      enabled: c.gallery.enabled,
      itemsPerPage: c.gallery.itemsPerPage,
      allowVideos: c.gallery.allowVideos,
      layout: c.gallery.layout,
    },
    featuredMemories: await serializePublicTributes(ctx, featured, c),
    acknowledgments: [...c.publicAcknowledgments]
      .filter((a) => a.visible)
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ id: a.id, name: a.name, message: a.message })),
    tributeLimits: { minLength: TRIBUTE_MIN_LENGTH, maxLength: TRIBUTE_MAX_LENGTH },
  };
}

/** ADMIN config: public settings plus private settings and raw category data. */
export function serializeAdminConfig(c: ISiteConfig) {
  return {
    memorialTitle: c.memorialTitle,
    grandmotherDisplayName: c.grandmotherDisplayName,
    portraitMediaId: c.portraitMediaId ? String(c.portraitMediaId) : null,
    introductoryMessage: c.introductoryMessage,
    closingMessage: c.closingMessage,
    tributeSubmissionsOpen: c.tributeSubmissionsOpen,
    relationshipCategories: sortedCategories(c).map((x) => ({
      id: x.id,
      name: x.name,
      order: x.order,
      visible: x.visible,
    })),
    gallery: {
      enabled: c.gallery.enabled,
      itemsPerPage: c.gallery.itemsPerPage,
      allowVideos: c.gallery.allowVideos,
      layout: c.gallery.layout,
    },
    featuredMemories: c.featuredMemories.map(String),
    publicAcknowledgments: [...c.publicAcknowledgments]
      .sort((a, b) => a.order - b.order)
      .map((a) => ({ id: a.id, name: a.name, message: a.message, order: a.order, visible: a.visible })),
    privateSettings: {
      notificationEmail: c.privateSettings?.notificationEmail ?? '',
      moderationGuidelines: c.privateSettings?.moderationGuidelines ?? '',
      internalNotes: c.privateSettings?.internalNotes ?? '',
    },
    updatedAt: c.updatedAt.toISOString(),
  };
}
