import mongoose, { Schema, model, type Model, type Types } from 'mongoose';
import {
  MEDIA_CATEGORIES,
  MEDIA_TYPES,
  MEDIA_VISIBILITIES,
  MODERATION_STATUSES,
  type MediaCategory,
  type MediaType,
} from '../constants.js';

export interface IMedia {
  _id: Types.ObjectId;
  storageKey: string;
  mediaType: MediaType;
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  altText?: string;
  caption?: string;
  visibility: 'public' | 'private';
  uploadedAt?: Date | null;
  uploadedBy?: Types.ObjectId | null;
  moderationStatus: 'pending' | 'approved' | 'rejected';
  category: MediaCategory;
  /** awaiting_upload: URL issued, object not yet verified. uploaded: verified by magic bytes + size. */
  uploadStatus: 'awaiting_upload' | 'uploaded';
  /** TTL: unfinished uploads are dropped from the DB after this time. */
  pendingExpiresAt?: Date | null;
  displayOrder: number;
  isFeatured: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<IMedia>(
  {
    storageKey: { type: String, required: true, unique: true },
    mediaType: { type: String, enum: MEDIA_TYPES, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 0 },
    width: { type: Number, min: 0, default: null },
    height: { type: Number, min: 0, default: null },
    duration: { type: Number, min: 0, default: null },
    altText: { type: String, trim: true, maxlength: 500 },
    caption: { type: String, trim: true, maxlength: 1000 },
    visibility: { type: String, enum: MEDIA_VISIBILITIES, default: 'private', required: true },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'Administrator', default: null },
    moderationStatus: { type: String, enum: MODERATION_STATUSES, default: 'pending', required: true },
    category: { type: String, enum: MEDIA_CATEGORIES, required: true },
    uploadStatus: { type: String, enum: ['awaiting_upload', 'uploaded'], default: 'awaiting_upload' },
    pendingExpiresAt: { type: Date, default: null },
    displayOrder: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'Administrator', default: null },
  },
  { timestamps: true },
);

mediaSchema.index({ category: 1, visibility: 1, moderationStatus: 1, displayOrder: 1 });
mediaSchema.index({ uploadStatus: 1, createdAt: -1 });
// Remove abandoned upload records automatically.
mediaSchema.index(
  { pendingExpiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { uploadStatus: 'awaiting_upload' } },
);

export const Media: Model<IMedia> =
  (mongoose.models.Media as Model<IMedia> | undefined) ?? model<IMedia>('Media', mediaSchema);
