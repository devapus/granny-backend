import type { Request } from 'express';
import { AuditEvent } from '../models/AuditEvent.js';

export type AuditAction =
  | 'admin.login'
  | 'admin.logout'
  | 'tribute.update'
  | 'tribute.approve'
  | 'tribute.reject'
  | 'tribute.remove'
  | 'tribute.reorder'
  | 'gallery.create'
  | 'gallery.update'
  | 'gallery.delete'
  | 'media.upload_url'
  | 'media.complete'
  | 'config.update'
  | 'categories.update';

export interface AuditInput {
  action: AuditAction;
  resourceType: 'admin' | 'tribute' | 'media' | 'gallery' | 'config';
  resourceId?: string;
  summary: string;
}

/**
 * Record an audit event for the authenticated admin. Summaries must not contain personal data
 * beyond internal identifiers. Failures are logged but never break the originating request.
 */
export async function recordAudit(req: Request, input: AuditInput, adminId = req.admin?._id): Promise<void> {
  if (!adminId) return;
  try {
    await AuditEvent.create({
      adminId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      summary: input.summary.slice(0, 500),
      correlationId: req.correlationId,
    });
  } catch (err) {
    req.log.error({ err, action: input.action }, 'Failed to write audit event');
  }
}
