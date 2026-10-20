import type { PresignedUpload, StorageService } from '../../src/services/r2.js';

/** In-memory StorageService for tests. `put()` simulates a client PUT to the presigned URL. */
export class FakeStorage implements StorageService {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  deleted: string[] = [];
  constructor(private readonly configured = true) {}

  isConfigured() {
    return this.configured;
  }
  async createUploadUrl(input: { key: string; contentType: string; contentLength: number }): Promise<PresignedUpload> {
    return {
      url: `https://fake-r2.test/upload/${input.key}?sig=abc`,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.contentLength) },
    };
  }
  put(key: string, body: Buffer, contentType = 'application/octet-stream') {
    this.objects.set(key, { body, contentType });
  }
  async headObject(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, contentType: o.contentType } : null;
  }
  async getObjectBytes(key: string, start: number, end: number) {
    const o = this.objects.get(key);
    return o ? o.body.subarray(start, end + 1) : null;
  }
  async deleteObject(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  async getDownloadUrl(key: string) {
    return `https://fake-r2.test/download/${key}?sig=xyz`;
  }
  publicUrl(key: string) {
    return `https://media.fake-r2.test/${key}`;
  }
}

// Minimal valid file headers for magic-byte detection.
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex'),
]);
export const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'binary'),
  Buffer.alloc(64, 1),
  Buffer.from([0xff, 0xd9]),
]);
export const NOT_AN_IMAGE = Buffer.from('<?php echo "this is not an image"; ?>'.repeat(5));
