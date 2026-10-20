import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Tribute } from '../src/models/Tribute.js';
import { useTestApp, validTribute } from './helpers/testApp.js';

const t = useTestApp();
const post = (body: unknown) => request(t.app).post('/api/v1/tributes').send(body as object);

describe('POST /tributes - valid submissions', () => {
  it('creates a pending tribute and returns a receipt without email', async () => {
    const res = await post(validTribute());
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.body)).not.toContain('jane@example.com');
    expect(res.headers['x-correlation-id']).toBeTruthy();

    const stored = await Tribute.findOne({ _id: res.body.data.id });
    expect(stored?.status).toBe('pending');
    expect(stored?.email).toBe('jane@example.com');
    expect(stored?.acknowledgment).toBe(true);
  });

  it('never lets the client set status or moderation fields', async () => {
    const res = await post(
      validTribute({ status: 'approved', isFeatured: true, approvedBy: '64b000000000000000000000', displayOrder: 1, publishedAt: new Date() }),
    );
    expect(res.status).toBe(201);
    const stored = await Tribute.findById(res.body.data.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.isFeatured).toBe(false);
    expect(stored?.approvedBy).toBeNull();
    expect(stored?.publishedAt).toBeNull();
    expect(stored?.displayOrder).toBe(0);
  });

  it('sanitises HTML and control characters, normalises email', async () => {
    const res = await post(
      validTribute({ fullName: '  <b>Jane</b>   Doe\u0000 ', email: ' JANE@Example.COM ', tributeText: 'She was <script>alert(1)</script>wonderful and kind to everyone she met.' }),
    );
    expect(res.status).toBe(201);
    const stored = await Tribute.findById(res.body.data.id);
    expect(stored?.fullName).toBe('Jane Doe');
    expect(stored?.email).toBe('jane@example.com');
    expect(stored?.tributeText).not.toContain('<script>');
  });

  it('accepts "other" with a custom relationship', async () => {
    const res = await post(validTribute({ relationshipCategory: 'other', customRelationship: 'Her old teacher' }));
    expect(res.status).toBe(201);
    expect((await Tribute.findById(res.body.data.id))?.customRelationship).toBe('Her old teacher');
  });
});

describe('POST /tributes - invalid submissions', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['tribute too short (19 chars)', { tributeText: 'x'.repeat(19) }, 'tributeText'],
    ['tribute too long (5001 chars)', { tributeText: 'x'.repeat(5001) }, 'tributeText'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['missing full name', { fullName: '   ' }, 'fullName'],
    ['acknowledgment false', { acknowledgment: false }, 'acknowledgment'],
    ['acknowledgment missing', { acknowledgment: undefined }, 'acknowledgment'],
    ['unknown category', { relationshipCategory: 'aliens' }, 'relationshipCategory'],
    ['"other" without custom relationship', { relationshipCategory: 'other' }, 'customRelationship'],
    ['bad submissionId', { submissionId: 'abc' }, 'submissionId'],
    ['bad media id', { contributorPhotoMediaId: 'nope' }, 'contributorPhotoMediaId'],
  ];
  it.each(cases)('rejects: %s', async (_name, override, path) => {
    const res = await post(validTribute(override));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    expect(await Tribute.countDocuments()).toBe(0);
  });

  it('accepts boundary lengths 20 and 5000', async () => {
    expect((await post(validTribute({ tributeText: 'a'.repeat(20) }))).status).toBe(201);
    expect((await post(validTribute({ tributeText: 'b'.repeat(5000) }))).status).toBe(201);
  });

  it('rejects NoSQL-operator style payloads', async () => {
    const res = await post(validTribute({ email: { $ne: null }, fullName: { $gt: '' } }));
    expect(res.status).toBe(400);
  });

  it('rejects photo ids that were never uploaded', async () => {
    const res = await post(validTribute({ contributorPhotoMediaId: '64b000000000000000000000' }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_MEDIA');
  });

  it('rejects submissions when closed', async () => {
    const { SiteConfig } = await import('../src/models/SiteConfig.js');
    const { getSiteConfig } = await import('../src/services/siteConfig.js');
    await getSiteConfig();
    await SiteConfig.updateOne({ key: 'default' }, { tributeSubmissionsOpen: false });
    const res = await post(validTribute());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBMISSIONS_CLOSED');
  });
});

describe('POST /tributes - idempotency', () => {
  it('replays the same submissionId from the body without duplicating', async () => {
    const submissionId = randomUUID();
    const first = await post(validTribute({ submissionId }));
    const second = await post(validTribute({ submissionId }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await Tribute.countDocuments()).toBe(1);
  });

  it('supports the Idempotency-Key header', async () => {
    const key = randomUUID();
    const send = () => request(t.app).post('/api/v1/tributes').set('Idempotency-Key', key).send(validTribute());
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(first.body.data.submissionId).toBe(key);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await Tribute.countDocuments()).toBe(1);
  });

  it('handles concurrent duplicate submissions with one record', async () => {
    const submissionId = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => post(validTribute({ submissionId }))));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Tribute.countDocuments()).toBe(1);
  });

  it('returns 409 when the key is reused with different content', async () => {
    const submissionId = randomUUID();
    await post(validTribute({ submissionId })).expect(201);
    const res = await post(validTribute({ submissionId, tributeText: 'A completely different tribute text that is long enough.' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects an invalid Idempotency-Key and mismatching header/body ids', async () => {
    const bad = await request(t.app).post('/api/v1/tributes').set('Idempotency-Key', 'nope').send(validTribute());
    expect(bad.status).toBe(400);
    const mismatch = await request(t.app)
      .post('/api/v1/tributes')
      .set('Idempotency-Key', randomUUID())
      .send(validTribute({ submissionId: randomUUID() }));
    expect(mismatch.status).toBe(400);
  });
});
