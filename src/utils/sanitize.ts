import { createHash } from 'node:crypto';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAGS = /<\/?[a-zA-Z!][^>]*>/g;

/**
 * Normalise user supplied text: unicode NFC, strip control characters and HTML tags,
 * normalise newlines. Output is always plain text; clients must still render it as text.
 */
export function sanitizeText(input: string, { multiline = false } = {}): string {
  let out = input.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').replace(HTML_TAGS, '');
  if (multiline) {
    out = out.replace(/\n{3,}/g, '\n\n');
  } else {
    out = out.replace(/\s+/g, ' ');
  }
  return out.trim();
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
