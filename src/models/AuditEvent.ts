import mongoose, { Schema, model, type Model, type Types } from 'mongoose';

export interface IAuditEvent {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  correlationId: string;
  createdAt: Date;
}

const auditEventSchema = new Schema<IAuditEvent>({
  adminId: { type: Schema.Types.ObjectId, ref: 'Administrator', required: true, index: true },
  action: { type: String, required: true, maxlength: 80 },
  resourceType: { type: String, required: true, maxlength: 40 },
  resourceId: { type: String, maxlength: 64 },
  summary: { type: String, required: true, maxlength: 500 },
  correlationId: { type: String, required: true, maxlength: 64 },
  createdAt: { type: Date, default: () => new Date(), immutable: true },
});

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

export const AuditEvent: Model<IAuditEvent> =
  (mongoose.models.AuditEvent as Model<IAuditEvent> | undefined) ?? model<IAuditEvent>('AuditEvent', auditEventSchema);
