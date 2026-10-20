import type { AppContext } from '../context.js';
import type { Logger } from '../utils/logger.js';
import type { IAdministrator } from '../models/Administrator.js';

declare global {
  namespace Express {
    interface Request {
      ctx: AppContext;
      correlationId: string;
      log: Logger;
      admin?: IAdministrator;
    }
  }
}
