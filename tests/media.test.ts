import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Media } from '../src/models/Media.js';
import { Tribute } from '../src/models/Tribute.js';
import { FakeStorage, JPEG_BYTES, NOT_AN_IMAGE, PNG_BYTES } from './helpers/fakeStorage.js';
import { loggedInAdmin, useTestApp, validTribute } from './helpers/testApp.js';

const t = useTestApp();
const API = '/api/v1';

async function publicUpload(opts: { bytes?: Buffer; contentType?: string; category?: string; declaredSize?: number } = {}) {
  const bytes = opts.bytes ?? PNG_BYTES;
  const res = await request(t.app)
    .post(`${API}/media/upload-url`)
    .send({ contentType: opts.contentType ?? 'image/png', fileSize: opts.declaredSize ?? bytes.length, category: opts.category ?? 'tribute_contributor' });
  return { res, bytes };
}

async function fullPublicUpload(category = 'tribute_contributor', bytes = PNG_BYTES, contentType = 'image/png') {
  const { res } = await publicUpload({ bytes, contentType, category });
  expect(res.status).toBe(201);
  const { mediaId, completionToken } = res.body.data;
  const media = await Media.findById(mediaId);
  t.storage.put(media!.storageKey, bytes, contentType);
  const done = await request(t.app).post(`${API}/media/complete`).send({ mediaId, completionToken });
  return { mediaId: mediaId as string, completionToken: completionToken as string, done };
}

describe('public media upload flow', () => {
  it('issues a presigned URL for a valid image and creates a private awaiting media record', async () => {
    const { res } = await publicUpload();
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d.upload.method).toBe('PUT');
    expect(d.upload.url).toContain('https://fake-r2.test/upload/tributes/');
    expect(d.upload.headers['Content-Type']).toBe('image/png');
    expect(d.completionToken).toBeTruthy();
    const media = await Media.findById(d.mediaId);
    expect(media).toMatchObject({ visibility: 'private', moderationStatus: 'pending', uploadStatus: 'awaiting_upload', mediaType: 'image', category: 'tribute_contributor' });
    expect(media?.storageKey).toMatch(/^tributes\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
  });

  it.each([
    ['unsupported type', { contentType: 'application/pdf' }, 422, 'UNSUPPORTED_MEDIA_TYPE'],
    ['svg (script-capable)', { contentType: 'image/svg+xml' }, 422, 'UNSUPPORTED_MEDIA_TYPE'],
    ['video on public endpoint', { contentType: 'video/mp4' }, 422, 'UNSUPPORTED_MEDIA_TYPE'],
    ['non-tribute category', { category: 'gallery_family' }, 403, 'UPLOAD_CATEGORY_FORBIDDEN'],
    ['too large', { declaredSize: 50 * 1024 * 1024 }, 422, 'FILE_TOO_LARGE'],
  ])('rejects %s', async (_n, opts, status, code) => {
    const { res } = await publicUpload(opts as never);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(await Media.countDocuments()).toBe(0);
  });

  it('validates the request body', async () => {
    const res = await request(t.app).post(`${API}/media/upload-url`).send({ contentType: 'image/png', fileSize: -4, category: 'nope' });
    expect(res.status).toBe(400);
  });

  it('verifies the uploaded object via magic bytes and marks it uploaded', async () => {
    const { done, mediaId, completionToken } = await fullPublicUpload();
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('uploaded');
    const media = await Media.findById(mediaId);
    expect(media?.uploadStatus).toBe('uploaded');
    expect(media?.uploadedAt).toBeInstanceOf(Date);
    expect(media?.pendingExpiresAt).toBeNull();
    // idempotent
    const again = await request(t.app).post(`${API}/media/complete`).send({ mediaId, completionToken });
    expect(again.status).toBe(200);
  });

  it('rejects and deletes files whose bytes do not match the declared type', async () => {
    const { res } = await publicUpload({ bytes: NOT_AN_IMAGE, contentType: 'image/jpeg' });
    const { mediaId, completionToken } = res.body.data;
    const media = await Media.findById(mediaId);
    t.storage.put(media!.storageKey, NOT_AN_IMAGE, 'image/jpeg');
    const done = await request(t.app).post(`${API}/media/complete`).send({ mediaId, completionToken });
    expect(done.status).toBe(422);
    expect(done.body.error.code).toBe('INVALID_FILE_CONTENT');
    expect(t.storage.deleted).toContain(media!.storageKey);
    expect(await Media.findById(mediaId)).toBeNull();
  });

  it('rejects a PNG declared as JPEG', async () => {
    const { res } = await publicUpload({ bytes: PNG_BYTES, contentType: 'image/jpeg' });
    const media = await Media.findById(res.body.data.mediaId);
    t.storage.put(media!.storageKey, PNG_BYTES);
    const done = await request(t.app).post(`${API}/media/complete`).send({ mediaId: res.body.data.mediaId, completionToken: res.body.data.completionToken });
    expect(done.status).toBe(422);
    expect(done.body.error.code).toBe('INVALID_FILE_CONTENT');
  });

  it('accepts a JPEG declared as JPEG', async () => {
    const { done } = await fullPublicUpload('tribute_grandmother', JPEG_BYTES, 'image/jpeg');
    expect(done.status).toBe(200);
  });

  it('rejects complete when the declared size differs from the stored object', async () => {
    const { res } = await publicUpload({ declaredSize: PNG_BYTES.length + 10 });
    const media = await Media.findById(res.body.data.mediaId);
    t.storage.put(media!.storageKey, PNG_BYTES);
    const done = await request(t.app).post(`${API}/media/complete`).send({ mediaId: res.body.data.mediaId, completionToken: res.body.data.completionToken });
    expect(done.status).toBe(422);
    expect(done.body.error.code).toBe('FILE_SIZE_MISMATCH');
  });

  it('rejects complete before the file has been uploaded', async () => {
    const { res } = await publicUpload();
    const done = await request(t.app).post(`${API}/media/complete`).send({ mediaId: res.body.data.mediaId, completionToken: res.body.data.completionToken });
    expect(done.status).toBe(422);
    expect(done.body.error.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('requires a valid completion token bound to the media id', async () => {
    const a = await publicUpload();
    const b = await publicUpload();
    const noToken = await request(t.app).post(`${API}/media/complete`).send({ mediaId: a.res.body.data.mediaId });
    expect(noToken.status).toBe(403);
    const wrongToken = await request(t.app).post(`${API}/media/complete`).send({ mediaId: a.res.body.data.mediaId, completionToken: b.res.body.data.completionToken });
    expect(wrongToken.status).toBe(403);
    expect(wrongToken.body.error.code).toBe('COMPLETION_TOKEN_INVALID');
  });
});

describe('storage not configured', () => {
  const unconfigured = new FakeStorage(false);
  const app = () => createApp({ config: t.config, storage: unconfigured, ensureDb: async () => undefined });

  it('public media endpoints return 503 with a clear error (never fake success)', async () => {
    const up = await request(app()).post(`${API}/media/upload-url`).send({ contentType: 'image/png', fileSize: 100, category: 'tribute_contributor' });
    expect(up.status).toBe(503);
    expect(up.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(up.body.error.message).toMatch(/R2/);
    const done = await request(app()).post(`${API}/media/complete`).send({ mediaId: '64b000000000000000000000', completionToken: 'x' });
    expect(done.status).toBe(503);
    expect(await Media.countDocuments()).toBe(0);
  });

  it('admin media endpoints return 503 too', async () => {
    await loggedInAdmin(t.app); // creates admin in DB
    const a = request.agent(app());
    const tok = (await a.get(`${API}/csrf-token`)).body.data.csrfToken as string;
    await a.post(`${API}/admin/auth/login`).set('X-CSRF-Token', tok).send({ email: 'admin@example.com', password: 'correct-horse-battery-staple' }).expect(200);
    const res = await a.post(`${API}/admin/media/upload-url`).set('X-CSRF-Token', tok).send({ contentType: 'image/png', fileSize: 100, category: 'gallery_family' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('non-media endpoints still work', async () => {
    expect((await request(app()).get(`${API}/public/config`)).status).toBe(200);
  });
});

describe('tribute photos', () => {
  it('attaches uploaded photos, and exposes them publicly only if approved AND permission granted', async () => {
    const admin = await loggedInAdmin(t.app);
    const c = await fullPublicUpload('tribute_contributor');
    const g = await fullPublicUpload('tribute_grandmother', JPEG_BYTES, 'image/jpeg');

    const mk = (permission: boolean, ids: { c: string; g: string }) =>
      request(t.app).post(`${API}/tributes`).send(validTribute({ contributorPhotoMediaId: ids.c, grandmotherPhotoMediaId: ids.g, photoDisplayPermission: permission }));
    const created = await mk(true, { c: c.mediaId, g: g.mediaId });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    // pending: not visible anywhere publicly and media stays private
    expect((await request(t.app).get(`${API}/tributes/${id}`)).status).toBe(404);
    expect((await Media.findById(c.mediaId))?.visibility).toBe('private');

    // photos can't be re-used by another tribute
    const reuse = await mk(true, { c: c.mediaId, g: g.mediaId });
    expect(reuse.status).toBe(422);

    await admin.post(`${API}/admin/tributes/${id}/approve`).expect(200);
    const pub = await request(t.app).get(`${API}/tributes/${id}`).expect(200);
    expect(pub.body.data.contributorPhoto.url).toMatch(/^https:\/\/media\.fake-r2\.test\/tributes\//);
    expect(pub.body.data.grandmotherPhoto.id).toBe(g.mediaId);
    expect(JSON.stringify(pub.body)).not.toContain('storageKey');
    expect(JSON.stringify(pub.body)).not.toContain('uploadedBy');

    // withdrawing permission hides the photos again
    await admin.patch(`${API}/admin/tributes/${id}`).send({ photoDisplayPermission: false }).expect(200);
    const hidden = await request(t.app).get(`${API}/tributes/${id}`).expect(200);
    expect(hidden.body.data.contributorPhoto).toBeNull();
    expect(hidden.body.data.grandmotherPhoto).toBeNull();
    expect((await Media.findById(c.mediaId))?.visibility).toBe('private');
  });

  it('does not show photos for approved tributes without permission', async () => {
    const admin = await loggedInAdmin(t.app);
    const c = await fullPublicUpload('tribute_contributor');
    const created = await request(t.app).post(`${API}/tributes`).send(validTribute({ contributorPhotoMediaId: c.mediaId, photoDisplayPermission: false }));
    await admin.post(`${API}/admin/tributes/${created.body.data.id}/approve`).expect(200);
    const pub = await request(t.app).get(`${API}/tributes/${created.body.data.id}`).expect(200);
    expect(pub.body.data.contributorPhoto).toBeNull();
    expect((await Media.findById(c.mediaId))?.visibility).toBe('private');
  });

  it('rejects a photo of the wrong category and un-completed uploads', async () => {
    const c = await fullPublicUpload('tribute_contributor');
    const wrong = await request(t.app).post(`${API}/tributes`).send(validTribute({ grandmotherPhotoMediaId: c.mediaId }));
    expect(wrong.status).toBe(422);
    const { res } = await publicUpload();
    const pending = await request(t.app).post(`${API}/tributes`).send(validTribute({ contributorPhotoMediaId: res.body.data.mediaId }));
    expect(pending.status).toBe(422);
    expect(await Tribute.countDocuments()).toBe(0);
  });
});

describe('admin media authorization', () => {
  it('requires authentication for upload-url and complete', async () => {
    const c = await (await import('./helpers/testApp.js')).csrfAgent(t.app);
    expect((await c.post(`${API}/admin/media/upload-url`).send({ contentType: 'image/png', fileSize: 10, category: 'gallery_family' })).status).toBe(401);
    expect((await c.post(`${API}/admin/media/complete`).send({ mediaId: '64b000000000000000000000' })).status).toBe(401);
    expect(await Media.countDocuments()).toBe(0);
  });

  it('lets an authenticated admin upload gallery images and videos, no completion token needed', async () => {
    const admin = await loggedInAdmin(t.app);
    const up = await admin.post(`${API}/admin/media/upload-url`).send({ contentType: 'image/jpeg', fileSize: JPEG_BYTES.length, category: 'gallery_family' }).expect(201);
    expect(up.body.data.completionToken).toBeUndefined();
    const media = await Media.findById(up.body.data.mediaId);
    expect(media?.moderationStatus).toBe('approved');
    expect(media?.uploadedBy).toBeTruthy();
    t.storage.put(media!.storageKey, JPEG_BYTES);
    const done = await admin.post(`${API}/admin/media/complete`).send({ mediaId: up.body.data.mediaId, width: 800, height: 600 }).expect(200);
    expect(done.body.data).toMatchObject({ uploadStatus: 'uploaded', width: 800, height: 600, visibility: 'private' });

    // a mislabeled category/type pair is rejected
    const bad = await admin.post(`${API}/admin/media/upload-url`).send({ contentType: 'video/mp4', fileSize: 1000, category: 'gallery_family' });
    expect(bad.status).toBe(422);
    const video = await admin.post(`${API}/admin/media/upload-url`).send({ contentType: 'video/mp4', fileSize: 1000, category: 'gallery_video' });
    expect(video.status).toBe(201);
  });
});

describe('gallery', () => {
  async function adminImage(admin: Awaited<ReturnType<typeof loggedInAdmin>>) {
    const up = await admin.post(`${API}/admin/media/upload-url`).send({ contentType: 'image/png', fileSize: PNG_BYTES.length, category: 'gallery_family' }).expect(201);
    const media = await Media.findById(up.body.data.mediaId);
    t.storage.put(media!.storageKey, PNG_BYTES);
    await admin.post(`${API}/admin/media/complete`).send({ mediaId: up.body.data.mediaId }).expect(200);
    return up.body.data.mediaId as string;
  }

  it('only publishes gallery items that are curated, public, uploaded and not deleted', async () => {
    const admin = await loggedInAdmin(t.app);
    const uncurated = await adminImage(admin);
    const pub = await adminImage(admin);
    const priv = await adminImage(admin);
    const del = await adminImage(admin);

    // un-curated uploads remain private
    expect((await request(t.app).get(`${API}/gallery`).expect(200)).body.data).toHaveLength(0);
    await admin.post(`${API}/admin/gallery`).send({ mediaId: pub, altText: 'Granny in the garden', caption: 'Summer 1998' }).expect(201);
    await admin.post(`${API}/admin/gallery`).send({ mediaId: priv, altText: 'Private one', visibility: 'private' }).expect(201);
    await admin.post(`${API}/admin/gallery`).send({ mediaId: del, altText: 'To delete' }).expect(201);
    await admin.delete(`${API}/admin/gallery/${del}`).expect(200);

    const list = await request(t.app).get(`${API}/gallery`).expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([pub]);
    expect(list.body.data[0]).toMatchObject({ altText: 'Granny in the garden', caption: 'Summer 1998', mediaType: 'image' });
    expect(JSON.stringify(list.body)).not.toContain('storageKey');
    await request(t.app).get(`${API}/gallery/${pub}`).expect(200);
    for (const id of [uncurated, priv, del]) expect((await request(t.app).get(`${API}/gallery/${id}`)).status).toBe(404);

    // soft delete retains the record
    expect((await Media.findById(del))?.deletedAt).toBeInstanceOf(Date);

    // admin patch: make private item public, edit alt text
    const patched = await admin.patch(`${API}/admin/gallery/${priv}`).send({ visibility: 'public', altText: 'Now public' }).expect(200);
    expect(patched.body.data.altText).toBe('Now public');
    expect((await request(t.app).get(`${API}/gallery`)).body.data).toHaveLength(2);
    expect((await admin.get(`${API}/admin/gallery`).expect(200)).body.data).toHaveLength(3);
  });

  it('never exposes tribute photos through the gallery, even if public', async () => {
    const c = await fullPublicUpload('tribute_contributor');
    await Media.updateOne({ _id: c.mediaId }, { visibility: 'public', moderationStatus: 'approved' });
    expect((await request(t.app).get(`${API}/gallery`).expect(200)).body.data).toHaveLength(0);
    expect((await request(t.app).get(`${API}/gallery/${c.mediaId}`)).status).toBe(404);
  });

  it('requires admin auth for gallery CRUD', async () => {
    const c = await (await import('./helpers/testApp.js')).csrfAgent(t.app);
    expect((await c.get(`${API}/admin/gallery`)).status).toBe(401);
    expect((await c.post(`${API}/admin/gallery`).send({ mediaId: '64b000000000000000000000', altText: 'x' })).status).toBe(401);
  });

  it('rejects video/category mismatches', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await adminImage(admin);
    const res = await admin.post(`${API}/admin/gallery`).send({ mediaId: id, altText: 'x', category: 'gallery_video' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_GALLERY_CATEGORY');
  });
});
