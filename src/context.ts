import type { AppConfig } from './config/env.js';
import type { Logger } from './utils/logger.js';
import type { StorageService } from './services/r2.js';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  storage: StorageService;
  /** Ensures the database is connected (cached). Overridable in tests. */
  ensureDb: () => Promise<void>;
}
