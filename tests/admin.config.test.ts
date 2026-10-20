import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SiteConfig } from '../src/models/SiteConfig.js';
import { PNG_BYTES } from './helpers/fakeStorage.js';
import { Media } from '../src/models/Media.js';
import { loggedInAdmin, submitTribute, useTestApp } from './helpers/testApp.js';

const t = useTestApp();
const A = '/api/v1/admin';

describe('admin config', () => {
  it('returns defaults including private settings to admins only', async () => {
    const admin = await loggedInAdmin(t.app);
    const res = await admin.get(`${A}/config`).expect(200);
    expect(res.body.data.memorialTitle).toBe('House of Memories');
    expect(res.body.data.privateSettings).toBeDefined();
    expect(res.body.data.relationshipCategories).toHaveLength(8);
    expect((await request(t.app).get(`${A}/config`)).status).toBe(401);
  });

  it('patches public and private settings; public config reflects only the public ones', async () => {
    const admin = await loggedInAdmin(t.app);
    await admin
      .patch(`${A}/config`)
      .send({
        memorialTitle: 'Remembering Granny',
        grandmotherDisplayName: 'Eleanor "Granny" Smith',
        closingMessage: 'Rest gently.',
        gallery: { itemsPerPage: 12, layout: 'masonry' },
        publicAcknowledgments: [{ id: 'ack1', name: 'The Smith Family', message: 'With thanks' }],
        privateSettings: { notificationEmail: 'owner@example.com', internalNotes: 'call the church' },
      })
      .expect(200);
    const pub = (await request(t.app).get('/api/v1/public/config').expect(200)).body.data;
    expect(pub.memorialTitle).toBe('Remembering Granny');
    expect(pub.grandmotherDisplayName).toBe('Eleanor "Granny" Smith');
    expect(pub.gallery).toMatchObject({ itemsPerPage: 12, layout: 'masonry', enabled: true });
    expect(pub.acknowledgments).toEqual([{ id: 'ack1', name: 'The Smith Family', message: 'With thanks' }]);
    expect(JSON.stringify(pub)).not.toContain('owner@example.com');
    expect(JSON.stringify(pub)).not.toContain('call the church');
    const adminCfg = (await admin.get(`${A}/config`)).body.data;
    expect(adminCfg.privateSettings.notificationEmail).toBe('owner@example.com');
  });

  it('validates config input', async () => {
    const admin = await loggedInAdmin(t.app);
    expect((await admin.patch(`${A}/config`).send({})).status).toBe(400);
    expect((await admin.patch(`${A}/config`).send({ memorialTitle: '' })).status).toBe(400);
    expect((await admin.patch(`${A}/config`).send({ gallery: { itemsPerPage: 5000 } })).status).toBe(400);
    expect((await admin.patch(`${A}/config`).send({ featuredMemories: ['64b000000000000000000000'] })).status).toBe(422);
    expect((await admin.patch(`${A}/config`).send({ portraitMediaId: '64b000000000000000000000' })).status).toBe(422);
  });

  it('only features approved tributes and drops removed ones from featured memories', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app);
    expect((await admin.patch(`${A}/config`).send({ featuredMemories: [id] })).status).toBe(422);
    await admin.post(`${A}/tributes/${id}/approve`).expect(200);
    await admin.patch(`${A}/config`).send({ featuredMemories: [id] }).expect(200);
    expect((await request(t.app).get('/api/v1/public/config')).body.data.featuredMemories).toHaveLength(1);
    await admin.post(`${A}/tributes/${id}/remove`).send({}).expect(200);
    expect((await request(t.app).get('/api/v1/public/config')).body.data.featuredMemories).toHaveLength(0);
    expect((await SiteConfig.findOne())?.featuredMemories).toHaveLength(0);
  });

  it('sets a portrait from an uploaded image and exposes it publicly', async () => {
    const admin = await loggedInAdmin(t.app);
    const up = await admin.post(`${A}/media/upload-url`).send({ contentType: 'image/png', fileSize: PNG_BYTES.length, category: 'other' }).expect(201);
    t.storage.put((await Media.findById(up.body.data.mediaId))!.storageKey, PNG_BYTES);
    await admin.post(`${A}/media/complete`).send({ mediaId: up.body.data.mediaId }).expect(200);
    await admin.patch(`${A}/config`).send({ portraitMediaId: up.body.data.mediaId }).expect(200);
    const pub = (await request(t.app).get('/api/v1/public/config')).body.data;
    expect(pub.portrait.id).toBe(up.body.data.mediaId);
    expect(pub.portrait.url).toContain('https://');
  });
});

describe('category management', () => {
  it('renames, reorders and hides categories but refuses to delete them', async () => {
    const admin = await loggedInAdmin(t.app);
    const cats = (await admin.get(`${A}/config`)).body.data.relationshipCategories as Array<{ id: string; name: string }>;
    const reordered = [...cats].reverse().map((c, i) => ({ id: c.id, name: c.id === 'children' ? 'Sons & Daughters' : c.name, order: i, visible: true }));
    const res = await admin.patch(`${A}/categories`).send({ categories: reordered }).expect(200);
    expect(res.body.data.relationshipCategories[0].id).toBe('other');
    expect(res.body.data.relationshipCategories.find((c: { id: string }) => c.id === 'children').name).toBe('Sons & Daughters');

    const withNew = [...reordered, { id: 'colleagues', name: 'Colleagues', order: 99, visible: true }];
    await admin.patch(`${A}/categories`).send({ categories: withNew }).expect(200);

    const dropped = withNew.filter((c) => c.id !== 'friends');
    const bad = await admin.patch(`${A}/categories`).send({ categories: dropped });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('CATEGORY_DELETE_FORBIDDEN');

    expect((await admin.patch(`${A}/categories`).send({ categories: [{ id: 'A B', name: 'x' }] })).status).toBe(400);
    expect((await admin.patch(`${A}/categories`).send({ categories: [] })).status).toBe(400);
    expect((await request(t.app).patch(`${A}/categories`).send({})).status).toBe(403); // CSRF first
  });
});
