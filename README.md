# House of Memories – Backend API

Production-oriented REST API for the **House of Memories** digital memorial platform: public tribute
submission and browsing, a moderated gallery, and an authenticated admin surface. Built with
Node.js, Express 5, TypeScript (ESM), Mongoose, Zod, and deployable to Vercel as a serverless function.

- Stack: Express, Mongoose (MongoDB Atlas), Zod, `bcryptjs`, `jsonwebtoken`, `helmet`, `cors`, `cookie-parser`,
  `express-rate-limit`, `pino`, `uuid`, `file-type`, `@aws-sdk/client-s3` (+ presigner) for Cloudflare R2,
  `swagger-ui-express`.
- Tests: Vitest + Supertest + `mongodb-memory-server` (no external services needed).
- This package is standalone (not a monorepo); everything lives in this directory. Package manager: **pnpm**.

## Quick start

```bash
pnpm install
cp .env.example .env        # fill in values (see "Environment variables")
pnpm dev                    # http://localhost:4000  (API under /api/v1, docs at /api/docs)
```

You need a MongoDB (Atlas or local) URI in `MONGODB_URI`. Media endpoints return `503 STORAGE_NOT_CONFIGURED`
until Cloudflare R2 is configured – everything else works without it.

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run with `tsx watch` (reads `.env`) |
| `pnpm build` | Compile `src/` to `dist/` with `tsc` |
| `pnpm start` | Run the compiled server (`node dist/index.js`) |
| `pnpm test` / `pnpm test:watch` | Vitest (spins up an in-memory MongoDB) |
| `pnpm lint` | ESLint (typescript-eslint) |
| `pnpm typecheck` | `tsc --noEmit` over src, tests, scripts |
| `pnpm seed` | Sync indexes, create default config, bootstrap admin; `pnpm seed -- --sample` adds 3 sample approved tributes into an empty DB |

> **Test note:** `mongodb-memory-server` downloads a `mongod` binary on first run (needs network once, cached in
> `~/.cache/mongodb-binaries`). The pinned version is `7.0.14` (`package.json` → `config.mongodbMemoryServer.version`)
> because MongoDB 8.x binaries need macOS 13+. Bump it freely on newer machines / CI.

## Environment variables

See [`.env.example`](.env.example) (contains no secrets).

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | – | `development` \| `test` \| `production` |
| `MONGODB_URI` | **prod** | MongoDB Atlas connection string. In production startup **fails with a clear error** if missing |
| `MONGODB_DB_NAME` | – | Database name (otherwise taken from the URI) |
| `FRONTEND_ORIGIN` | **prod** | Comma-separated allowed browser origins for CORS/CSRF (e.g. `https://memorial.example.com`) |
| `JWT_SECRET` | **prod** | ≥32 chars; signs admin session JWTs |
| `CSRF_SECRET` | – | ≥32 chars; signs CSRF tokens (defaults to a value derived from `JWT_SECRET`) |
| `SESSION_TTL_HOURS` | – | Session lifetime (default 12) |
| `COOKIE_SAMESITE` | – | `lax` (default) \| `strict` \| `none`. Use `none` only if the frontend is on a different *site*; cookies are then `Secure` |
| `COOKIE_DOMAIN` | – | Optional cookie domain |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | – | If **no administrator exists**, one is created from these (password ≥12 chars). No-op afterwards – remove them once used |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | for media | Cloudflare R2 S3 credentials. Missing → media endpoints respond `503 STORAGE_NOT_CONFIGURED` |
| `R2_ENDPOINT` | – | Override endpoint (default `https://<account>.r2.cloudflarestorage.com`) |
| `R2_PUBLIC_BASE_URL` | – | Public bucket / custom-domain base URL. If unset, signed GET URLs (1h) are returned instead |
| `UPLOAD_URL_TTL_SECONDS`, `MAX_IMAGE_BYTES`, `MAX_VIDEO_BYTES` | – | Upload constraints (defaults 600s, 10 MiB, 200 MiB) |
| `RATE_LIMIT_{GLOBAL,AUTH,TRIBUTE,UPLOAD}_{MAX,WINDOW_MS}` | – | Rate-limit tuning |
| `TRUST_PROXY` | – | Proxy hops for client IP detection (default 1; correct for Vercel) |
| `ENABLE_DOCS` | – | Serve Swagger UI at `/api/docs` (default: on outside production) |
| `LOG_LEVEL`, `PORT` | – | Logging level, local port |

## Architecture

```
api/index.js            Vercel entrypoint (re-exports Express app built into dist/)
src/index.ts            Local/long-running server (connects DB, bootstrap, graceful shutdown)
src/app.ts              createApp(): middleware chain + routes (dependency-injectable for tests)
src/config/env.ts       Zod-validated configuration (fails fast in production)
src/db/connection.ts    Cached Mongoose connection (reused across warm serverless invocations)
src/models/             Tribute, Media, Administrator, SiteConfig, AuditEvent
src/validation/         Zod request schemas (sanitising + strict typing, blocks operator injection)
src/routes, controllers Thin HTTP layer
src/services/           tributes, media, siteConfig, auth (JWT/bcrypt/CSRF/bootstrap), audit, r2
src/serializers/        Explicit allow-list response shapes (public vs admin)
src/middleware/         correlation id, logging, errors, csrf, auth, rate limit, db
openapi.yaml            OpenAPI 3 spec (served at /api/docs and /api/openapi.json)
scripts/seed.ts         Seed / index sync
tests/                  Vitest + Supertest suites
```

Response envelope: success → `{ "data": …, "meta"?: { page, limit, total, totalPages } }`;
error → `{ "error": { "code", "message", "details"?, "correlationId" } }`.

## API summary (`/api/v1`)

Full detail in `openapi.yaml` / Swagger UI (`/api/docs`).

**Public**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/config` | Title, names, messages, visible categories (ordered), gallery settings, featured memories, public acknowledgments, tribute limits. Never includes private settings |
| GET | `/tributes` | Published (approved & not deleted) only. `page`, `limit≤50`, `category`, `featured`. Ordered by category order then `displayOrder` |
| GET | `/tributes/:id` | Published only, else 404 |
| POST | `/tributes` | Creates a **pending** tribute. Idempotent by `submissionId` (`Idempotency-Key` / `X-Submission-Id` header or body). `201` first time, `200` + `Idempotent-Replay: true` on replay, `409` if reused with different content. Any client-sent `status` is ignored |
| GET | `/gallery`, `/gallery/:id` | Published gallery media only |
| POST | `/media/upload-url` | Presigned R2 PUT for tribute photos (images only; rate limited). Returns `mediaId`, `upload{url,method,headers}`, `completionToken` |
| POST | `/media/complete` | Verifies the object (exists, exact size, **magic bytes** via `file-type`) and marks it uploaded; mismatching files are deleted |
| GET | `/csrf-token` | Issues CSRF token (cookie + JSON) |
| GET | `/health`, `/health/ready` | Liveness / DB readiness |

**Admin** (`/admin/...`, session cookie + CSRF header; all `Cache-Control: no-store`)

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /tributes` (filters: `status`, `category`, `q`, `includeDeleted`), `GET|PATCH /tributes/:id`,
  `POST /tributes/:id/approve|reject|remove` (`DELETE /tributes/:id` = remove), `PUT /tributes/order`
- `GET|POST /gallery`, `GET|PATCH|DELETE /gallery/:id` (soft delete)
- `POST /media/upload-url`, `POST /media/complete` (images and videos, no completion token)
- `GET|PATCH /config`, `PATCH /categories`
- `GET /audit-events` (filters: `action`, `resourceType`, `adminId`)

### Moderation rules

- Statuses: `pending → approved | rejected`, `rejected → approved`, `approved → rejected` (unpublish), any live status → `removed`.
  Invalid transitions return `409 INVALID_STATUS_TRANSITION`. `PATCH` can never change `status`.
- Approval stamps `approvedAt/By`, `publishedAt` and appends the tribute to the end of its category (`displayOrder`).
- Removal is a **soft delete** (`deletedAt/By`); gallery deletion is soft too. Removed tributes are dropped from featured memories.
- `PUT /admin/tributes/order` `{ category?, orderedIds[] }` assigns each approved tribute its index within its own category.
- Categories can be renamed/reordered/hidden via `PATCH /admin/categories` but **not deleted** (existing tributes reference them).
- Tribute photos become public only when the tribute is approved **and** `photoDisplayPermission` is true.

### Defaults

Categories (in order): `children, grandchildren, siblings, other_family, friends, neighbors, community, other`
(`other` requires a `customRelationship`). Memorial title *House of Memories*; the introductory message is the
specified default; the closing message is a tasteful default; tribute length 20–5000 characters.
All defaults are created on first read of the singleton `SiteConfig` and are editable via `PATCH /admin/config`.

## Data model & indexes

- **Tribute**: `submissionId` (unique), `fullName`, `email`, `relationshipCategory`, `customRelationship`, `tributeText`,
  `contributorPhotoMediaId`, `grandmotherPhotoMediaId`, `photoDisplayPermission`, `acknowledgment`, `status`,
  `displayOrder`, `isFeatured`, `approvedAt/By`, `rejectedAt/By`, `publishedAt`, `editedAt`, `moderationNotes`,
  `deletedAt/By`, timestamps (+ internal `payloadHash`, never selected by default, for idempotency conflict detection).
- **Media**: `storageKey`, `mediaType`, `mimeType`, `fileSize`, `width`, `height`, `duration`, `altText`, `caption`,
  `visibility`, `uploadedAt`, `uploadedBy`, `moderationStatus`, `category` (+ `uploadStatus`, `displayOrder`, `isFeatured`,
  soft-delete fields). Abandoned `awaiting_upload` records expire via a TTL index.
- **Administrator**: `email` (unique), `passwordHash` (bcrypt, `select:false`), `role`, `isActive`, `createdAt`, `lastLoginAt`.
- **SiteConfig** (singleton): public settings plus a separate `privateSettings` object that public serializers never touch.
- **AuditEvent**: `adminId`, `action`, `resourceType`, `resourceId`, `summary`, `correlationId`, `createdAt`.

Indexes: `Tribute.submissionId` unique; `Tribute {status, relationshipCategory, displayOrder}` (public listing);
`Tribute {status, createdAt:-1}` (admin queue); plus media/audit indexes. Indexes are created on connect
(`autoIndex`) and by `pnpm seed`.

## Security

- **Sessions**: signed JWT (HS256, issuer/audience pinned) in an `HttpOnly`, `SameSite` cookie (`Secure` in production).
  The admin record is re-checked on every request, so deactivating an admin ends their sessions immediately.
  Passwords are hashed with bcrypt (cost 12; implemented with the pure-JS `bcryptjs` for painless serverless builds).
  Logout clears the cookie (JWTs are stateless; keep `SESSION_TTL_HOURS` modest).
- **CSRF**: signed double-submit token. `GET /csrf-token` sets the `hom_csrf` cookie and returns the token; the client
  echoes it as `X-CSRF-Token` on every admin `POST/PUT/PATCH/DELETE` (including login/logout). The header must match the
  cookie and carry a valid HMAC; a present `Origin` header must also be an allowed frontend origin.
  Public endpoints don't authenticate with cookies and therefore don't require CSRF tokens.
- **CORS** limited to `FRONTEND_ORIGIN` (credentials allowed); other origins get `403`.
- **helmet** security headers; `x-powered-by` disabled; 100 kb JSON body limit.
- **Rate limits** (per IP): global, login (default 10/15 min), tribute submission (5/h), public upload URLs (20/h).
  Limiters use the in-memory store, i.e. **per serverless instance**. For hard guarantees on Vercel, back
  `express-rate-limit` with Redis/Upstash (`rate-limit-redis`) – the limiter factory is in `src/middleware/rateLimit.ts`.
- **Privacy**: public tribute/config/gallery responses use explicit allow-list serializers – never `email`,
  `submissionId`, moderation fields, admin ids, storage keys or private settings. Public reads also `$project` private
  fields out at the database layer. Audit summaries contain no personal data and logs redact emails/cookies.
- **Input**: Zod validation with text sanitising (HTML tags/control chars stripped), strings only (rejects `$`-operator
  objects), ids validated as ObjectIds.
- **Errors**: uniform shape, correlation id on every response (`X-Correlation-Id`, client value echoed if well-formed),
  no stack traces or internal messages in production 5xx responses.
- **Uploads**: allow-listed MIME types (JPEG/PNG/WebP/AVIF; MP4/WebM/MOV for admin videos only; SVG is rejected),
  signed `Content-Type`/`Content-Length`, per-type size caps, and server-side magic-byte verification on `complete`.
  Public completion requires a short-lived signed `completionToken` bound to the media id.

## Cloudflare R2 setup

1. Create a bucket and an **R2 API token** (Object Read & Write) → set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
2. **CORS on the bucket** (needed for browser PUT uploads): allow origin `FRONTEND_ORIGIN`, methods `PUT`/`GET`/`HEAD`,
   headers `Content-Type`, `Content-Length`.
3. For public delivery, attach a custom domain / enable the public `r2.dev` URL and set `R2_PUBLIC_BASE_URL`.
   Otherwise short-lived signed URLs are generated.
4. Optional lifecycle rule to purge never-completed objects under `tributes/` after a few days (their DB records expire automatically).

Client flow: `POST /media/upload-url` → `PUT` file to `upload.url` with `upload.headers` → `POST /media/complete`
(`mediaId`, `completionToken`) → submit the tribute with the returned `mediaId`s.

## Deploying to Vercel

`vercel.json` runs `pnpm build` and routes every path to `api/index.js`, which imports the compiled app from `dist/`.

1. Import this directory as a Vercel project (Root Directory = `memorial-backend`).
2. Set the environment variables above (at minimum `MONGODB_URI`, `FRONTEND_ORIGIN`, `JWT_SECRET`, and for media the `R2_*` set).
3. In MongoDB Atlas, allow Vercel egress (Atlas *Network Access*; `0.0.0.0/0` with strong credentials, or Vercel Secure Compute / static IPs).
4. Set `COOKIE_SAMESITE=none` if the frontend is served from a different registrable domain than the API (HTTPS only),
   otherwise keep `lax` and put both on the same site (e.g. `www.` and `api.` subdomains with `COOKIE_DOMAIN`).
5. First deploy creates the admin from `ADMIN_BOOTSTRAP_*` on the first request; then remove those variables.
   Run `pnpm seed` once (locally with the production URI) to pre-build indexes if you prefer not to rely on `autoIndex`.

The app exports a plain Express handler, which Vercel's Node.js runtime invokes directly; Mongoose connections are cached
on `globalThis` so warm invocations reuse them. Invalid configuration in production is logged clearly and every request
returns `500 MISCONFIGURED` rather than silently running with defaults.

> The Vercel entrypoint is `api/index.js` (plain JS importing the compiled `dist/`), not `.ts`, so that Vercel never
> has to resolve TypeScript ESM `.js` specifiers; `dist/` is produced by the build step.

## Testing

`pnpm test` runs 100+ tests against an in-memory MongoDB with an injected fake object store (no network or credentials).
Coverage areas: tribute submission (valid/invalid/boundaries/sanitising/status injection), idempotency (replay, concurrency,
conflict), email privacy, public filtering/pagination/ordering, admin login/logout/CSRF/bootstrap, unauthorized access,
approve/reject/remove transitions, ordering, audit events, media upload flow (magic bytes, size mismatch, tokens, 503 when R2 is
missing, authorization), gallery, config/categories, rate limiting, error format, production error hygiene and env validation.

## Production launch checklist

1. Create MongoDB Atlas cluster + database user; set `MONGODB_URI` / `MONGODB_DB_NAME`.
2. Allow Vercel egress in Atlas Network Access.
3. Generate `JWT_SECRET` and `CSRF_SECRET` (≥32 chars each); set `FRONTEND_ORIGIN` to the live site origin.
4. Set `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (≥12 chars) for first deploy only.
5. Create Cloudflare R2 bucket + API token; set all required `R2_*` vars; configure bucket CORS for the frontend origin.
6. Decide public media delivery (`R2_PUBLIC_BASE_URL` custom domain or signed URLs) and document the access model.
7. Deploy this project to Vercel; confirm `/api/v1/health` and `/api/v1/health/ready`.
8. Hit any authenticated admin route once so bootstrap creates the administrator; then **remove** bootstrap env vars and redeploy.
9. Run `pnpm seed` against production URI if you want indexes/config seeded outside of first-request auto-create.
10. Align cookies: same-site → `COOKIE_SAMESITE=lax` (+ optional `COOKIE_DOMAIN`); cross-site → `none` + HTTPS.
11. Point the frontend `VITE_API_BASE_URL` at this API and verify CORS + credentialed admin login.
12. End-to-end: submit tribute → pending in admin → approve → visible publicly; reject stays hidden; emails absent from public responses.
13. Upload gallery media; confirm unpublished/private objects are not world-readable.
14. Enable monitoring (Vercel logs + Atlas alerts); schedule backups / point-in-time recovery on Atlas.
15. Review retention: soft-deleted tributes/media policy; purge orphaned R2 objects periodically.
16. Do **not** call the system production-ready until Atlas, R2, secrets, and admin bootstrap cleanup are complete.

## Backup and recovery

- **Database:** Enable Atlas continuous backup / PITR. Restore to a new cluster, update `MONGODB_URI`, redeploy.
- **Media:** Enable R2 versioning or periodic sync to a second bucket; restore objects by key from `Media.storageKey`.
- **Config:** Export `SiteConfig` and category order after major edits; keep audit events for forensic review.
- **Secrets:** Rotate `JWT_SECRET` / `CSRF_SECRET` only with a planned logout of all admins.

## Known limitations / notes

- Rate limiting is per instance (see Security). 
- Stateless JWT sessions can't be revoked individually before expiry (deactivate the admin to cut access).
- `width`/`height`/`duration` for uploads are client-supplied (bounds-checked); the server verifies file type and size only.
- Only a single `admin` role exists; there is no admin-management endpoint (bootstrap + DB for now).
- Real MongoDB Atlas and Cloudflare R2 integrations are implemented but were not exercised against live accounts in this environment (unit/integration tests use an in-memory DB and a fake object store).
