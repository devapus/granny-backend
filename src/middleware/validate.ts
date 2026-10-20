import type { z } from 'zod';
import { validationError } from '../utils/errors.js';

/** Parse untrusted input with a Zod schema, throwing a uniform 400 on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    throw validationError(
      result.error.issues.map((i) => ({ path: i.path.join('.') || undefined, message: i.message })),
    );
  }
  return result.data;
}
