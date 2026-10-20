import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Administrator } from '../src/models/Administrator.js';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/createApp.js';
import { bootstrapAdmin, resetBootstrapFlag, signSession } from '../src/services/auth.js';
import { createLogger } from '../src/utils/logger.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, createAdmin, csrfAgent, loggedInAdmin, submitTribute, useTestApp } from './helpers/testApp.js';

const t = useTestApp();
const login = (c: Awaited<ReturnType<typeof csrfAgent>>, body: object) => c.post('/api/v1/admin/auth/login').send(body);

describe('admin authentication', () => {
  it('logs in, sets an HttpOnly SameSite cookie, and serves /me', async () => {
    await createAdmin();
    const c = await csrfAgent(t.app);
    const res = await login(c, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.admin).toMatchObject({ email: ADMIN_EMAIL, role: 'admin' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((x) => x.startsWith('hom_session='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//);

    const me = await c.get('/api/v1/admin/auth/me').expect(200);
    expect(me.body.data.admin.email).toBe(ADMIN_EMAIL);
    expect((await Administrator.findOne({ email: ADMIN_EMAIL }))?.lastLoginAt).toBeInstanceOf(Date);
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('stores bcrypt hashes, never plaintext', async () => {
    await createAdmin();
    const a = await Administrator.findOne({ email: ADMIN_EMAIL }).select('+passwordHash');
    expect(a?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(a?.passwordHash).not.toContain(ADMIN_PASSWORD);
  });

  it('rejects wrong password and unknown users with the same error', async () => {
    await createAdmin();
    const c = await csrfAgent(t.app);
    const wrong = await login(c, { email: ADMIN_EMAIL, password: 'nope-nope-nope' });
    const unknown = await login(c, { email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.headers['set-cookie']?.toString() ?? '').not.toContain('hom_session');
  });

  it('rejects inactive administrators', async () => {
    const a = await createAdmin();
    await Administrator.updateOne({ _id: a._id }, { isActive: false });
    const c = await csrfAgent(t.app);
    expect((await login(c, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status).toBe(401);
  });

  it('validates login body', async () => {
    const c = await csrfAgent(t.app);
    expect((await login(c, { email: 'bad', password: '' })).status).toBe(400);
    expect((await login(c, { email: { $ne: null }, password: { $ne: null } })).status).toBe(400);
  });

  it('logout clears the cookie and ends access', async () => {
    const c = await loggedInAdmin(t.app);
    const out = await c.post('/api/v1/admin/auth/logout').expect(200);
    expect(out.headers['set-cookie']?.toString()).toMatch(/hom_session=;/);
    await c.get('/api/v1/admin/auth/me').expect(401);
  });

  it('rejects forged / expired / wrong-secret session tokens', async () => {
    const a = await createAdmin();
    const forged = signSession({ ...t.config, jwtSecret: 'x'.repeat(40) }, a);
    const res = await request(t.app).get('/api/v1/admin/auth/me').set('Cookie', `hom_session=${forged}`);
    expect(res.status).toBe(401);
    const garbage = await request(t.app).get('/api/v1/admin/auth/me').set('Cookie', 'hom_session=garbage');
    expect(garbage.status).toBe(401);
  });

  it('invalidates the session when the admin is deactivated', async () => {
    const c = await loggedInAdmin(t.app);
    await Administrator.updateOne({ email: ADMIN_EMAIL }, { isActive: false });
    await c.get('/api/v1/admin/auth/me').expect(401);
  });
});

describe('unauthorized access to admin endpoints', () => {
  const protectedGets = ['/auth/me', '/tributes', '/tributes/64b000000000000000000000', '/gallery', '/config', '/audit-events'];
  it.each(protectedGets)('GET /admin%s requires authentication', async (path) => {
    const res = await request(t.app).get(`/api/v1/admin${path}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('mutations without a session are rejected (401) once CSRF is satisfied', async () => {
    const c = await csrfAgent(t.app);
    const id = await submitTribute(t.app);
    expect((await c.post(`/api/v1/admin/tributes/${id}/approve`)).status).toBe(401);
    expect((await c.patch('/api/v1/admin/config').send({ memorialTitle: 'Hacked' })).status).toBe(401);
    expect((await c.post('/api/v1/admin/media/upload-url').send({})).status).toBe(401);
    // and the tribute stayed pending
    const { Tribute } = await import('../src/models/Tribute.js');
    expect((await Tribute.findById(id))?.status).toBe('pending');
  });
});

describe('CSRF protection', () => {
  it('rejects admin mutations without a CSRF token', async () => {
    await createAdmin();
    const res = await request(t.app).post('/api/v1/admin/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a mismatching or forged token', async () => {
    await createAdmin();
    const c = await csrfAgent(t.app);
    const mismatch = await c.agent.post('/api/v1/admin/auth/login').set('X-CSRF-Token', 'abc.def').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(mismatch.status).toBe(403);
    const forged = 'AAAA.BBBB';
    const res = await request(t.app)
      .post('/api/v1/admin/auth/login')
      .set('Cookie', `hom_csrf=${forged}`)
      .set('X-CSRF-Token', forged)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin Origin header even with a valid token', async () => {
    await createAdmin();
    const c = await csrfAgent(t.app);
    const res = await c.post('/api/v1/admin/auth/login').set('Origin', 'https://evil.example').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('allows the configured frontend origin', async () => {
    await createAdmin();
    const c = await csrfAgent(t.app);
    const res = await c.post('/api/v1/admin/auth/login').set('Origin', 'http://localhost:3000').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('reuses a valid CSRF cookie token on subsequent calls', async () => {
    const c = await csrfAgent(t.app);
    const again = await c.get('/api/v1/csrf-token').expect(200);
    expect(again.body.data.csrfToken).toBe(c.token);
  });
});

describe('admin bootstrap', () => {
  const logger = createLogger({ logLevel: 'silent', nodeEnv: 'test' });
  const cfg = (extra: Record<string, string>) => loadConfig({ NODE_ENV: 'test', ...extra });

  it('creates the first admin once when none exists', async () => {
    const config = cfg({ ADMIN_BOOTSTRAP_EMAIL: 'Boot@Example.com', ADMIN_BOOTSTRAP_PASSWORD: 'a-very-long-password-1' });
    expect(await bootstrapAdmin(config, logger)).toBe(true);
    resetBootstrapFlag();
    expect(await bootstrapAdmin(config, logger)).toBe(false);
    expect(await Administrator.countDocuments()).toBe(1);
    expect((await Administrator.findOne())?.email).toBe('boot@example.com');
  });

  it('does not create an admin if one exists or env is missing', async () => {
    await createAdmin();
    const config = cfg({ ADMIN_BOOTSTRAP_EMAIL: 'boot@example.com', ADMIN_BOOTSTRAP_PASSWORD: 'a-very-long-password-1' });
    expect(await bootstrapAdmin(config, logger)).toBe(false);
    expect(await Administrator.countDocuments()).toBe(1);
    await Administrator.deleteMany({});
    resetBootstrapFlag();
    expect(await bootstrapAdmin(cfg({}), logger)).toBe(false);
    expect(await Administrator.countDocuments()).toBe(0);
  });

  it('bootstraps on first request and the admin can log in', async () => {
    const app = createApp({
      config: { ...t.config, adminBootstrapEmail: 'first@example.com', adminBootstrapPassword: 'first-admin-password-123' },
      logger,
      storage: t.storage,
      ensureDb: async () => undefined,
    });
    const agent = request.agent(app);
    const tok = (await agent.get('/api/v1/csrf-token')).body.data.csrfToken as string;
    const res = await agent.post('/api/v1/admin/auth/login').set('X-CSRF-Token', tok).send({ email: 'first@example.com', password: 'first-admin-password-123' });
    expect(res.status).toBe(200);
  });

  it('rejects weak bootstrap passwords at config load', () => {
    expect(() => cfg({ ADMIN_BOOTSTRAP_EMAIL: 'a@b.co', ADMIN_BOOTSTRAP_PASSWORD: 'short' })).toThrow(/12 characters/);
  });
});
