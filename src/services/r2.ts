import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/env.js';

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** Abstraction over object storage so routes/tests do not depend on the AWS SDK directly. */
export interface StorageService {
  isConfigured(): boolean;
  createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  }): Promise<PresignedUpload>;
  /** Returns null if the object does not exist. */
  headObject(key: string): Promise<{ size: number; contentType?: string } | null>;
  /** Read an inclusive byte range (used for magic-byte sniffing). Returns null if missing. */
  getObjectBytes(key: string, start: number, end: number): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  /** Short-lived signed GET URL for private objects. */
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  /** Permanent URL if the bucket / custom domain is public. */
  publicUrl(key: string): string | null;
}

export function isR2Configured(r2: AppConfig['r2']): boolean {
  return Boolean(r2.accessKeyId && r2.secretAccessKey && r2.bucket && (r2.accountId || r2.endpoint));
}

function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound' || err.name === 'NoSuchKey';
  }
  return false;
}

export class R2StorageService implements StorageService {
  private client: S3Client | null = null;

  constructor(private readonly r2: AppConfig['r2']) {}

  isConfigured(): boolean {
    return isR2Configured(this.r2);
  }

  private get bucket(): string {
    return this.r2.bucket as string;
  }

  private getClient(): S3Client {
    if (!this.client) {
      const endpoint = this.r2.endpoint ?? `https://${this.r2.accountId}.r2.cloudflarestorage.com`;
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: this.r2.accessKeyId as string,
          secretAccessKey: this.r2.secretAccessKey as string,
        },
        // R2 does not support the SDK's default flexible checksums on presigned URLs.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    }
    return this.client;
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  }): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    const url = await getSignedUrl(this.getClient(), command, {
      expiresIn: input.expiresIn,
      // content-type and content-length are signed: the client must send exactly what was declared.
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.contentLength) },
    };
  }

  async headObject(key: string) {
    try {
      const res = await this.getClient().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getObjectBytes(key: string, start: number, end: number): Promise<Buffer | null> {
    try {
      const res = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      if (!res.Body) return Buffer.alloc(0);
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.getClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(this.getClient(), new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
    });
  }

  publicUrl(key: string): string | null {
    return this.r2.publicBaseUrl ? `${this.r2.publicBaseUrl}/${key}` : null;
  }
}
