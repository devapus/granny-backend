import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Tribute } from '../src/models/Tribute.js';
import { loggedInAdmin, submitTribute, useTestApp } from './helpers/testApp.js';

const t = useTestApp();
const api = (url: string) => request(t.app).get(`/api/v1${url}`);

describe('public tribute visibility and email privacy', () => {
  it('only returns approved, non-deleted tributes', async () => {
    const admin = await loggedInAdmin(t.app);
    const pending = await submitTribute(t.app, { fullName: 'Pending Person' });
    const approved = await submitTribute(t.app, { fullName: 'Approved Person' });
    const rejected = await submitTribute(t.app, { fullName: 'Rejected Person' });
    const removed = await submitTribute(t.app, { fullName: 'Removed Person' });

    await admin.post(`/api/v1/admin/tributes/${approved}/approve`).expect(200);
    await admin.post(`/api/v1/admin/tributes/${rejected}/reject`).send({}).expect(200);
    await admin.post(`/api/v1/admin/tributes/${removed}/approve`).expect(200);
    await admin.post(`/api/v1/admin/tributes/${removed}/remove`).send({}).expect(200);

    const list = await api('/tributes').expect(200);
    expect(list.body.data.map((x: { fullName: string }) => x.fullName)).toEqual(['Approved Person']);
    expect(list.body.meta.total).toBe(1);

    await api(`/tributes/${approved}`).expect(200);
    for (const id of [pending, rejected, removed]) {
      const res = await api(`/tributes/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    await api('/tributes/not-an-id').expect(404);
    // removed tributes are soft-deleted, not hard-deleted
    expect(await Tribute.countDocuments({ _id: removed, deletedAt: { $ne: null } })).toBe(1);
  });

  it('never exposes email (or other private fields) on any public response', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app, { email: 'secret.person@private-mail.example', fullName: 'Secret Person' });
    await admin.patch(`/api/v1/admin/tributes/${id}`).send({ moderationNotes: 'internal only note', isFeatured: true }).expect(200);
    await admin.post(`/api/v1/admin/tributes/${id}/approve`).expect(200);
    await admin.patch('/api/v1/admin/config').send({ featuredMemories: [id], privateSettings: { notificationEmail: 'owner@private.example', internalNotes: 'hush' } }).expect(200);

    const responses = [await api('/tributes'), await api(`/tributes/${id}`), await api('/public/config')];
    for (const res of responses) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('private-mail.example');
      expect(text).not.toContain('"email"');
      expect(text).not.toContain('internal only note');
      expect(text).not.toContain('moderationNotes');
      expect(text).not.toContain('submissionId');
      expect(text).not.toContain('owner@private.example');
      expect(text).not.toContain('privateSettings');
      expect(text).not.toContain('approvedBy');
      expect(text).not.toContain('payloadHash');
    }
    expect(responses[2]!.body.data.featuredMemories).toHaveLength(1);
    expect(responses[0]!.body.data[0]).toEqual({
      id,
      fullName: 'Secret Person',
      relationshipCategory: 'grandchildren',
      relationshipLabel: 'Grandchildren',
      customRelationship: null,
      tributeText: expect.any(String),
      contributorPhoto: null,
      grandmotherPhoto: null,
      isFeatured: true,
      publishedAt: expect.any(String),
    });
  });

  it('paginates and validates query params', async () => {
    const admin = await loggedInAdmin(t.app);
    for (let i = 0; i < 5; i++) {
      const id = await submitTribute(t.app, { fullName: `Person ${i}` });
      await admin.post(`/api/v1/admin/tributes/${id}/approve`).expect(200);
    }
    const p1 = await api('/tributes?limit=2&page=1').expect(200);
    const p3 = await api('/tributes?limit=2&page=3').expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
    expect(p3.body.data).toHaveLength(1);
    expect((await api('/tributes?limit=1000')).status).toBe(400);
    expect((await api('/tributes?page=0')).status).toBe(400);
    // operator-style query keys are never interpreted as Mongo operators (ignored => unfiltered)
    const injected = await api('/tributes?category[$ne]=x');
    expect(injected.status).toBe(200);
    expect(injected.body.meta.total).toBe(5);
    expect((await api('/tributes?category=$ne')).status).toBe(400);
  });

  it('orders by category order then displayOrder and can filter by category', async () => {
    const admin = await loggedInAdmin(t.app);
    const mk = async (fullName: string, relationshipCategory: string, extra: Record<string, unknown> = {}) => {
      const id = await submitTribute(t.app, { fullName, relationshipCategory, ...extra });
      await admin.post(`/api/v1/admin/tributes/${id}/approve`).expect(200);
      return id;
    };
    // approval order intentionally scrambled relative to category order
    await mk('Friend A', 'friends');
    const g1 = await mk('Grandchild 1', 'grandchildren');
    await mk('Child 1', 'children');
    const g2 = await mk('Grandchild 2', 'grandchildren');
    await mk('Other 1', 'other', { customRelationship: 'Mail carrier' });

    let names = (await api('/tributes').expect(200)).body.data.map((x: { fullName: string }) => x.fullName);
    expect(names).toEqual(['Child 1', 'Grandchild 1', 'Grandchild 2', 'Friend A', 'Other 1']);

    // reorder grandchildren
    await admin.put('/api/v1/admin/tributes/order').send({ category: 'grandchildren', orderedIds: [g2, g1] }).expect(200);
    names = (await api('/tributes').expect(200)).body.data.map((x: { fullName: string }) => x.fullName);
    expect(names).toEqual(['Child 1', 'Grandchild 2', 'Grandchild 1', 'Friend A', 'Other 1']);

    const filtered = await api('/tributes?category=grandchildren').expect(200);
    expect(filtered.body.data).toHaveLength(2);
    expect((await api('/tributes').expect(200)).body.data.at(-1).relationshipLabel).toBe('Mail carrier');

    // category order follows admin-configured order
    const cats = (await admin.get('/api/v1/admin/config')).body.data.relationshipCategories as Array<{ id: string; name: string; order: number; visible: boolean }>;
    const swapped = cats.map((c) => (c.id === 'friends' ? { ...c, order: -1 + 0 } : c));
    // friends first: shift everything else by using explicit orders
    await admin
      .patch('/api/v1/admin/categories')
      .send({ categories: swapped.map((c) => ({ ...c, order: c.id === 'friends' ? 0 : c.order + 1 })) })
      .expect(200);
    names = (await api('/tributes').expect(200)).body.data.map((x: { fullName: string }) => x.fullName);
    expect(names[0]).toBe('Friend A');
  });
});

describe('public config', () => {
  it('returns defaults with categories in the required order', async () => {
    const res = await api('/public/config').expect(200);
    const d = res.body.data;
    expect(d.memorialTitle).toBe('House of Memories');
    expect(d.introductoryMessage).toBe(
      'Though I may no longer be here beside you, the love we shared lives on in every memory. Step inside and discover the beautiful things my family and friends remember about me.',
    );
    expect(d.closingMessage.length).toBeGreaterThan(40);
    expect(d.relationshipCategories.map((c: { id: string }) => c.id)).toEqual([
      'children',
      'grandchildren',
      'siblings',
      'other_family',
      'friends',
      'neighbors',
      'community',
      'other',
    ]);
    expect(d.tributeLimits).toEqual({ minLength: 20, maxLength: 5000 });
    expect(d.privateSettings).toBeUndefined();
  });

  it('hides invisible categories from the public config', async () => {
    const admin = await loggedInAdmin(t.app);
    const cats = (await admin.get('/api/v1/admin/config')).body.data.relationshipCategories;
    await admin
      .patch('/api/v1/admin/categories')
      .send({ categories: cats.map((c: { id: string }) => ({ ...c, visible: c.id !== 'neighbors' })) })
      .expect(200);
    const pub = (await api('/public/config').expect(200)).body.data.relationshipCategories.map((c: { id: string }) => c.id);
    expect(pub).not.toContain('neighbors');
    // and submissions into hidden categories are rejected
    const res = await request(t.app)
      .post('/api/v1/tributes')
      .send({ fullName: 'N', email: 'n@example.com', relationshipCategory: 'neighbors', tributeText: 'x'.repeat(30), acknowledgment: true });
    expect(res.status).toBe(400);
  });
});
