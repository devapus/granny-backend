import mongoose, { Schema, model, type Model, type Types } from 'mongoose';

export interface IRelationshipCategory {
  id: string;
  name: string;
  order: number;
  visible: boolean;
}

export interface IPublicAcknowledgment {
  id: string;
  name: string;
  message: string;
  order: number;
  visible: boolean;
}

export interface ISiteConfig {
  _id: Types.ObjectId;
  /** Singleton key. */
  key: 'default';

  // ---- public settings ----
  memorialTitle: string;
  grandmotherDisplayName: string;
  portraitMediaId?: Types.ObjectId | null;
  introductoryMessage: string;
  closingMessage: string;
  tributeSubmissionsOpen: boolean;
  relationshipCategories: IRelationshipCategory[];
  gallery: {
    enabled: boolean;
    itemsPerPage: number;
    allowVideos: boolean;
    layout: 'grid' | 'masonry';
  };
  featuredMemories: Types.ObjectId[];
  publicAcknowledgments: IPublicAcknowledgment[];

  // ---- private settings: NEVER serialized by public serializers ----
  privateSettings: {
    notificationEmail?: string;
    moderationGuidelines?: string;
    internalNotes?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<IRelationshipCategory>(
  {
    id: { type: String, required: true, match: /^[a-z0-9_]{1,40}$/ },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    order: { type: Number, required: true },
    visible: { type: Boolean, default: true },
  },
  { _id: false },
);

const acknowledgmentSchema = new Schema<IPublicAcknowledgment>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, default: '', trim: true, maxlength: 1000 },
    order: { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
  },
  { _id: false },
);

const siteConfigSchema = new Schema<ISiteConfig>(
  {
    key: { type: String, enum: ['default'], default: 'default', required: true, unique: true },
    memorialTitle: { type: String, required: true, trim: true, maxlength: 120 },
    grandmotherDisplayName: { type: String, required: true, trim: true, maxlength: 120 },
    portraitMediaId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    introductoryMessage: { type: String, required: true, maxlength: 2000 },
    closingMessage: { type: String, required: true, maxlength: 2000 },
    tributeSubmissionsOpen: { type: Boolean, default: true },
    relationshipCategories: { type: [categorySchema], default: [] },
    gallery: {
      enabled: { type: Boolean, default: true },
      itemsPerPage: { type: Number, default: 24, min: 1, max: 100 },
      allowVideos: { type: Boolean, default: true },
      layout: { type: String, enum: ['grid', 'masonry'], default: 'grid' },
    },
    featuredMemories: { type: [Schema.Types.ObjectId], ref: 'Tribute', default: [] },
    publicAcknowledgments: { type: [acknowledgmentSchema], default: [] },
    privateSettings: {
      notificationEmail: { type: String, trim: true, maxlength: 254 },
      moderationGuidelines: { type: String, maxlength: 4000 },
      internalNotes: { type: String, maxlength: 4000 },
    },
  },
  { timestamps: true, minimize: false },
);

export const SiteConfig: Model<ISiteConfig> =
  (mongoose.models.SiteConfig as Model<ISiteConfig> | undefined) ?? model<ISiteConfig>('SiteConfig', siteConfigSchema);
