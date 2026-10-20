import { rateLimit } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';

export function makeLimiter(opts: {
  max: number;
  windowMs: number;
  code: string;
  message: string;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: opts.code,
          message: opts.message,
          correlationId: req.correlationId,
        },
      });
    },
  });
}
