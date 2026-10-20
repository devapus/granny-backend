import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { Tribute } from '../src/models/Tribute.js';
import { loggedInAdmin, submitTribute, useTestApp } from './helpers/testApp.js';

const t = useTestApp();
const A = '/api/v1/admin';

describe('admin tribute moderation', () => {
  it('lists tributes with email and filters by status, newest first', async () => {
    const admin = await loggedInAdmin(t.app);
    const a = await submitTribute(t.app, { email: 'a@example.com', fullName: 'Alpha' });
    const b = await submitTribute(t.app, { email: 'b@example.com', fullName: 'Beta' });
    await admin.post(`${A}/tributes/${a}/approve`).expect(200);

    const all = await admin.get(`${A}/tributes`).expect(200);
    expect(all.body.data.map((x: { id: string }) => x.id)).toEqual([b, a]);
    expect(all.body.data[0].email).toBe('b@example.com');
    expect(all.body.data[0]).not.toHaveProperty('payloadHash');

    const pending = await admin.get(`${A}/tributes?status=pending`).expect(200);
    expect(pending.body.data.map((x: { id: string }) => x.id)).toEqual([b]);
    const search = await admin.get(`${A}/tributes?q=alph`).expect(200);
    expect(search.body.data.map((x: { id: string }) => x.id)).toEqual([a]);
    expect((await admin.get(`${A}/tributes?status=bogus`)).status).toBe(400);
    expect((await admin.get(`${A}/tributes/${b}`)).body.data.email).toBe('b@example.com');
  });

  it('approves a pending tribute: sets status, approver, timestamps and displayOrder', async () => {
    const admin = await loggedInAdmin(t.app);
    const id1 = await submitTribute(t.app);
    const id2 = await submitTribute(t.app);
    const r1 = await admin.post(`${A}/tributes/${id1}/approve`).expect(200);
    const r2 = await admin.post(`${A}/tributes/${id2}/approve`).expect(200);
    expect(r1.body.data.status).toBe('approved');
    expect(r1.body.data.approvedAt).toBeTruthy();
    expect(r1.body.data.publishedAt).toBeTruthy();
    expect(r1.body.data.approvedBy).toBeTruthy();
    expect(r2.body.data.displayOrder).toBe(r1.body.data.displayOrder + 1);
  });

  it('rejects a pending tribute and records who/when and the reason', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app);
    const res = await admin.post(`${A}/tributes/${id}/reject`).send({ reason: 'Contains personal contact details' }).expect(200);
    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejectedAt).toBeTruthy();
    expect(res.body.data.rejectedBy).toBeTruthy();
    expect(res.body.data.moderationNotes).toBe('Contains personal contact details');
    expect((await request(t.app).get(`/api/v1/tributes/${id}`)).status).toBe(404);
  });

  it('allows a rejected tribute to be approved later, and an approved one to be unpublished', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app);
    await admin.post(`${A}/tributes/${id}/reject`).send({}).expect(200);
    await admin.post(`${A}/tributes/${id}/approve`).expect(200);
    await request(t.app).get(`/api/v1/tributes/${id}`).expect(200);
    const un = await admin.post(`${A}/tributes/${id}/reject`).send({}).expect(200);
    expect(un.body.data.status).toBe('rejected');
    expect(un.body.data.publishedAt).toBeNull();
    await request(t.app).get(`/api/v1/tributes/${id}`).expect(404);
  });

  it('soft deletes via remove (and DELETE), preserving the document', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app);
    const res = await admin.post(`${A}/tributes/${id}/remove`).send({}).expect(200);
    expect(res.body.data.status).toBe('removed');
    expect(res.body.data.deletedAt).toBeTruthy();
    const doc = await Tribute.findById(id);
    expect(doc).not.toBeNull();
    expect(doc?.deletedAt).toBeInstanceOf(Date);

    const id2 = await submitTribute(t.app);
    await admin.delete(`${A}/tributes/${id2}`).expect(200);
    expect((await Tribute.findById(id2))?.status).toBe('removed');

    // hidden from default admin list; visible with status filter / includeDeleted
    expect((await admin.get(`${A}/tributes`)).body.data).toHaveLength(0);
    expect((await admin.get(`${A}/tributes?includeDeleted=true`)).body.data).toHaveLength(2);
    expect((await admin.get(`${A}/tributes?status=removed`)).body.data).toHaveLength(2);
  });

  it('enforces valid status transitions with 409', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app);
    await admin.post(`${A}/tributes/${id}/approve`).expect(200);
    const again = await admin.post(`${A}/tributes/${id}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    await admin.post(`${A}/tributes/${id}/remove`).send({}).expect(200);
    expect((await admin.post(`${A}/tributes/${id}/approve`)).status).toBe(404); // removed = not found for moderation
    expect((await admin.post(`${A}/tributes/64b000000000000000000000/approve`)).status).toBe(404);
    expect((await admin.post(`${A}/tributes/garbage/approve`)).status).toBe(404);
  });

  it('edits a tribute (marks editedAt) but cannot change status through PATCH', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app);
    const res = await admin
      .patch(`${A}/tributes/${id}`)
      .send({ tributeText: 'An edited tribute text that is still comfortably long enough.', status: 'approved', isFeatured: true })
      .expect(200);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.editedAt).toBeTruthy();
    expect(res.body.data.isFeatured).toBe(true);
    expect((await admin.patch(`${A}/tributes/${id}`).send({})).status).toBe(400);
    expect((await admin.patch(`${A}/tributes/${id}`).send({ tributeText: 'short' })).status).toBe(400);
    expect((await admin.patch(`${A}/tributes/${id}`).send({ relationshipCategory: 'nope' })).status).toBe(400);
  });

  it('moves displayOrder to the end of the new category when category changes on an approved tribute', async () => {
    const admin = await loggedInAdmin(t.app);
    const a = await submitTribute(t.app, { relationshipCategory: 'friends' });
    const b = await submitTribute(t.app, { relationshipCategory: 'children' });
    await admin.post(`${A}/tributes/${a}/approve`).expect(200);
    await admin.post(`${A}/tributes/${b}/approve`).expect(200);
    const res = await admin.patch(`${A}/tributes/${b}`).send({ relationshipCategory: 'friends' }).expect(200);
    expect(res.body.data.displayOrder).toBe(1);
  });
});

describe('display ordering', () => {
  it('reorders approved tributes by index', async () => {
    const admin = await loggedInAdmin(t.app);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await submitTribute(t.app, { fullName: `P${i}` });
      await admin.post(`${A}/tributes/${id}/approve`).expect(200);
      ids.push(id);
    }
    const reversed = [...ids].reverse();
    const res = await admin.put(`${A}/tributes/order`).send({ orderedIds: reversed }).expect(200);
    expect(res.body.data.updated).toBe(3);
    const orders = await Promise.all(reversed.map(async (id) => (await Tribute.findById(id))?.displayOrder));
    expect(orders).toEqual([0, 1, 2]);
  });

  it('validates order payloads', async () => {
    const admin = await loggedInAdmin(t.app);
    const pending = await submitTribute(t.app);
    expect((await admin.put(`${A}/tributes/order`).send({ orderedIds: [] })).status).toBe(400);
    expect((await admin.put(`${A}/tributes/order`).send({ orderedIds: [pending, pending] })).status).toBe(400);
    const res = await admin.put(`${A}/tributes/order`).send({ orderedIds: [pending] });
    expect(res.status).toBe(422); // not approved
    expect(res.body.error.code).toBe('INVALID_ORDER_IDS');
  });
});

describe('audit events', () => {
  it('records admin actions without personal data and lists them newest first', async () => {
    const admin = await loggedInAdmin(t.app);
    const id = await submitTribute(t.app, { email: 'audited@example.com', fullName: 'Audited Person' });
    await admin.post(`${A}/tributes/${id}/approve`).set('X-Correlation-Id', 'corr-approve-12345').expect(200);
    await admin.patch(`${A}/config`).send({ memorialTitle: 'In Loving Memory' }).expect(200);

    const res = await admin.get(`${A}/audit-events`).expect(200);
    const actions = res.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['config.update', 'tribute.approve', 'admin.login']);
    const approve = res.body.data.find((e: { action: string }) => e.action === 'tribute.approve');
    expect(approve).toMatchObject({ resourceType: 'tribute', resourceId: id, correlationId: 'corr-approve-12345' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('audited@example.com');
    expect(text).not.toContain('Audited Person');

    const filtered = await admin.get(`${A}/audit-events?action=tribute.approve`).expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(await AuditEvent.countDocuments()).toBe(3);
  });

  it('is not accessible without auth', async () => {
    expect((await request(t.app).get(`${A}/audit-events`)).status).toBe(401);
  });
});
