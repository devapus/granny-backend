export { Tribute, type ITribute } from './Tribute.js';
export { Media, type IMedia } from './Media.js';
export { Administrator, type IAdministrator } from './Administrator.js';
export { SiteConfig, type ISiteConfig, type IRelationshipCategory, type IPublicAcknowledgment } from './SiteConfig.js';
export { AuditEvent, type IAuditEvent } from './AuditEvent.js';

import type { Model } from 'mongoose';
import { Tribute } from './Tribute.js';
import { Media } from './Media.js';
import { Administrator } from './Administrator.js';
import { SiteConfig } from './SiteConfig.js';
import { AuditEvent } from './AuditEvent.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allModels: Model<any>[] = [Tribute, Media, Administrator, SiteConfig, AuditEvent];
