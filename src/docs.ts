import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

let cached: Record<string, unknown> | null = null;

function resolveOpenApiPath(): string {
  const candidates = [
    // From src/docs.ts or dist/docs.js → project root
    fileURLToPath(new URL('../openapi.yaml', import.meta.url)),
    // Bundled serverless layouts sometimes nest deeper
    fileURLToPath(new URL('../../openapi.yaml', import.meta.url)),
    join(process.cwd(), 'openapi.yaml'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error('openapi.yaml not found (include it via vercel.json includeFiles)');
}

export function loadOpenApiDocument(): Record<string, unknown> {
  if (!cached) {
    cached = YAML.parse(readFileSync(resolveOpenApiPath(), 'utf8')) as Record<string, unknown>;
  }
  return cached;
}

/** Swagger UI at /api/docs and the raw spec at /api/openapi.json. */
export function createDocsRouter(): Router {
  const router = Router();
  const relaxed = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  });
  router.get('/openapi.json', (_req, res) => {
    res.json(loadOpenApiDocument());
  });
  router.use('/docs', relaxed, swaggerUi.serve, (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) =>
    swaggerUi.setup(loadOpenApiDocument(), { customSiteTitle: 'House of Memories API' })(req, res, next),
  );
  return router;
}
