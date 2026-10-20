import {
  DEFAULT_CATEGORIES,
  DEFAULT_CLOSING_MESSAGE,
  DEFAULT_GRANDMOTHER_NAME,
  DEFAULT_INTRODUCTORY_MESSAGE,
  DEFAULT_MEMORIAL_TITLE,
} from '../constants.js';
import type { HydratedDocument } from 'mongoose';
import { SiteConfig, type ISiteConfig } from '../models/SiteConfig.js';

export function buildDefaultConfig() {
  return {
    key: 'default' as const,
    memorialTitle: DEFAULT_MEMORIAL_TITLE,
    grandmotherDisplayName: DEFAULT_GRANDMOTHER_NAME,
    portraitMediaId: null,
    introductoryMessage: DEFAULT_INTRODUCTORY_MESSAGE,
    closingMessage: DEFAULT_CLOSING_MESSAGE,
    tributeSubmissionsOpen: true,
    relationshipCategories: DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, name: c.name, order: i, visible: true })),
    gallery: { enabled: true, itemsPerPage: 24, allowVideos: true, layout: 'grid' as const },
    featuredMemories: [],
    publicAcknowledgments: [],
    privateSettings: {},
  };
}

/** Fetch the singleton config, creating it with defaults on first use (race-safe upsert). */
export async function getSiteConfig(): Promise<HydratedDocument<ISiteConfig>> {
  const existing = await SiteConfig.findOne({ key: 'default' });
  if (existing) return existing;
  try {
    return await SiteConfig.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: buildDefaultConfig() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).orFail();
  } catch (err) {
    // Lost an upsert race: the other writer's document is fine.
    const again = await SiteConfig.findOne({ key: 'default' });
    if (again) return again;
    throw err;
  }
}

export function sortedCategories(config: Pick<ISiteConfig, 'relationshipCategories'>) {
  return [...config.relationshipCategories].sort((a, b) => a.order - b.order);
}
