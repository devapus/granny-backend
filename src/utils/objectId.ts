import { Types } from 'mongoose';
import { z } from 'zod';
import { notFound } from './errors.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

export const objectIdSchema = z.string().regex(OBJECT_ID_RE, 'Must be a valid id');

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

/** Parse a route id; unknown/invalid ids are reported as 404 rather than leaking format details. */
export function parseIdParam(value: unknown, what = 'Resource'): Types.ObjectId {
  if (!isObjectId(value)) throw notFound(`${what} not found`);
  return new Types.ObjectId(value);
}
