import mongoose, { Schema, model, type Model, type Types } from 'mongoose';
import {
  CUSTOM_RELATIONSHIP_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  TRIBUTE_MAX_LENGTH,
  TRIBUTE_MIN_LENGTH,
  TRIBUTE_STATUSES,
  type TributeStatus,
} from '../constants.js';

export interface ITribute {
  _id: Types.ObjectId;
  submissionId: string;
  /** Hash of the submitted payload; used to detect idempotency-key reuse with different content. */
  payloadHash?: string;
  fullName: string;
  email: string;
  relationshipCategory: string;
  customRelationship?: string;
  tributeText: string;
  contributorPhotoMediaId?: Types.ObjectId | null;
  grandmotherPhotoMediaId?: Types.ObjectId | null;
  photoDisplayPermission: boolean;
  acknowledgment: boolean;
  status: TributeStatus;
  displayOrder: number;
  isFeatured: boolean;
  approvedAt?: Date | null;
  approvedBy?: Types.ObjectId | null;
  rejectedAt?: Date | null;
  rejectedBy?: Types.ObjectId | null;
  publishedAt?: Date | null;
  editedAt?: Date | null;
  moderationNotes?: string;
  // soft delete
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const tributeSchema = new Schema<ITribute>(
  {
    submissionId: { type: String, required: true, unique: true, maxlength: 64 },
    payloadHash: { type: String, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: FULL_NAME_MAX_LENGTH },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    relationshipCategory: { type: String, required: true, trim: true, maxlength: 64 },
    customRelationship: { type: String, trim: true, maxlength: CUSTOM_RELATIONSHIP_MAX_LENGTH },
    tributeText: { type: String, required: true, minlength: TRIBUTE_MIN_LENGTH, maxlength: TRIBUTE_MAX_LENGTH },
    contributorPhotoMediaId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    grandmotherPhotoMediaId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    photoDisplayPermission: { type: Boolean, required: true, default: false },
    acknowledgment: { type: Boolean, required: true, validate: (v: boolean) => v === true },
    status: { type: String, enum: TRIBUTE_STATUSES, default: 'pending', required: true },
    displayOrder: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'Administrator', default: null },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'Administrator', default: null },
    publishedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    moderationNotes: { type: String, maxlength: 2000 },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'Administrator', default: null },
  },
  { timestamps: true },
);

// Public listing: published tributes by category, ordered.
tributeSchema.index({ status: 1, relationshipCategory: 1, displayOrder: 1 });
// Admin moderation queue.
tributeSchema.index({ status: 1, createdAt: -1 });

export const Tribute: Model<ITribute> =
  (mongoose.models.Tribute as Model<ITribute> | undefined) ?? model<ITribute>('Tribute', tributeSchema);
