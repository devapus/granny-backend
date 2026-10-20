import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { FakeStorage } from './helpers/fakeStorage.js';
import { useTestApp, validTribute } from './helpers/testApp.js';

const API = '/api/v1';

const t = useTestApp();

describe('rate limiting', () => {
  // A second app instance (own in-memory limiter state) on the same DB with tight limits.
  const limited = () =>
    createApp({
      config: {
        ...t.config,
        rateLimits: { ...t.config.rateLimits, tribute: { max: 3, windowMs: 60_000 }, auth: { max: 4, windowMs: 60_000 }, upload: { max: 2, windowMs: 60_000 } },
      },
      logger: createLogger(t.config),
      storage: t.storage,
      ensureDb: async () => undefined,
    });

  it('limits tribute submissions per client with a 429 in the standard error format', async () => {
    const app = limited();
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post(`${API}/tributes`).send(validTribute());
      expect(ok.status).toBe(201);
    }
    const blocked = await request(app).post(`${API}/tributes`).send(validTribute());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(blocked.body.error.correlationId).toBeTruthy();
    expect(blocked.headers['ratelimit'] ?? blocked.headers['ratelimit-policy']).toBeTruthy();
    // reads are not affected by the submission limiter
    expect((await request(app).get(`${API}/tributes`)).status).toBe(200);
  });

  it('limits admin login attempts (brute force protection)', async () => {
    const app = limited();
    const agent = request.agent(app);
    const tok = (await agent.get(`${API}/csrf-token`)).body.data.csrfToken as string;
    const attempt = () => agent.post(`${API}/admin/auth/login`).set('X-CSRF-Token', tok).send({ email: 'x@example.com', password: 'wrong-password' });
    for (let i = 0; i < 4; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('limits public upload URL requests', async () => {
    const app = limited();
    const send = () => request(app).post(`${API}/media/upload-url`).send({ contentType: 'image/png', fileSize: 100, category: 'tribute_contributor' });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });
});

describe('error format and hardening', () => {
  it('uses a uniform error shape for 404s', async () => {
    const res = await request(t.app).get(`${API}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), correlationId: expect.any(String) } });
    expect(res.body.error.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('uses a uniform error shape for validation errors', async () => {
    const res = await request(t.app).post(`${API}/tributes`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details[0]).toHaveProperty('message');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('handles malformed JSON and oversized bodies', async () => {
    const bad = await request(t.app).post(`${API}/tributes`).set('Content-Type', 'application/json').send('{"oops":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const big = await request(t.app).post(`${API}/tributes`).send({ tributeText: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('echoes a well-formed client correlation id and replaces malformed ones', async () => {
    const good = await request(t.app).get(`${API}/health`).set('X-Correlation-Id', 'client-req-123456');
    expect(good.headers['x-correlation-id']).toBe('client-req-123456');
    const bad = await request(t.app).get(`${API}/health`).set('X-Correlation-Id', 'bad id with spaces <script>');
    expect(bad.headers['x-correlation-id']).not.toContain('<');
    expect(bad.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(t.app).get(`${API}/health`);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('applies CORS only for the configured frontend origin', async () => {
    const ok = await request(t.app).options(`${API}/tributes`).set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(t.app).get(`${API}/health`).set('Origin', 'https://evil.example');
    expect(evil.status).toBe(403);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(evil.body.error.code).toBe('CORS_ORIGIN_REJECTED');
  });

  it('serves the OpenAPI document and Swagger UI when docs are enabled', async () => {
    const spec = await request(t.app).get('/api/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.body.paths)).toEqual(expect.arrayContaining(['/tributes', '/admin/auth/login', '/media/upload-url']));
    const ui = await request(t.app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('reports DB state on readiness', async () => {
    const res = await request(t.app).get(`${API}/health/ready`);
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('connected');
  });
});

describe('production error handling', () => {
  const prodConfig = () =>
    loadConfig({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:1/never',
      FRONTEND_ORIGIN: 'https://memorial.example.com',
      JWT_SECRET: 'p'.repeat(48),
      LOG_LEVEL: 'silent',
    });

  it('never leaks stack traces or internal messages on 500s', async () => {
    const app = createApp({
      config: prodConfig(),
      logger: createLogger({ logLevel: 'silent', nodeEnv: 'production' }),
      storage: new FakeStorage(),
      ensureDb: async () => {
        throw new Error('secret internal failure at /srv/app/db.ts with password=hunter2');
      },
    });
    const res = await request(app).get(`${API}/tributes`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', correlationId: expect.any(String) } });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('/srv/app');
  });

  it('disables docs in production by default and uses secure cookies', async () => {
    const config = prodConfig();
    expect(config.enableDocs).toBe(false);
    const app = createApp({ config, logger: createLogger(config), storage: new FakeStorage(), ensureDb: async () => undefined });
    expect((await request(app).get('/api/docs/')).status).toBe(404);
    const res = await request(app).get(`${API}/csrf-token`).set('Origin', 'https://memorial.example.com');
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});

describe('configuration', () => {
  it('fails clearly in production when MONGODB_URI is missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://a.example', JWT_SECRET: 'x'.repeat(40) })).toThrow(ConfigError);
    try {
      loadConfig({ NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://a.example', JWT_SECRET: 'x'.repeat(40) });
    } catch (e) {
      expect((e as Error).message).toContain('MONGODB_URI is required in production');
    }
  });

  it('requires a strong JWT secret and frontend origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://x' })).toThrow(/JWT_SECRET[\s\S]*FRONTEND_ORIGIN|FRONTEND_ORIGIN[\s\S]*JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://x', FRONTEND_ORIGIN: 'https://a.example', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('does not require MONGODB_URI in test/development', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).mongodbUri).toBeUndefined();
    expect(loadConfig({ NODE_ENV: 'development' }).frontendOrigins).toEqual(['http://localhost:3000']);
  });

  it('parses multiple frontend origins and R2 values', () => {
    const c = loadConfig({
      NODE_ENV: 'test',
      FRONTEND_ORIGIN: 'https://a.example/, https://b.example',
      R2_PUBLIC_BASE_URL: 'https://media.example/',
    });
    expect(c.frontendOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.r2.publicBaseUrl).toBe('https://media.example');
  });
});
