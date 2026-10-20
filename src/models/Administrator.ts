import mongoose, { Schema, model, type Model, type Types } from 'mongoose';

export interface IAdministrator {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: 'admin';
  isActive: boolean;
  createdAt: Date;
  lastLoginAt?: Date | null;
}

const administratorSchema = new Schema<IAdministrator>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin'], default: 'admin', required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: () => new Date() },
  lastLoginAt: { type: Date, default: null },
});

export const Administrator: Model<IAdministrator> =
  (mongoose.models.Administrator as Model<IAdministrator> | undefined) ??
  model<IAdministrator>('Administrator', administratorSchema);
