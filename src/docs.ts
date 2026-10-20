import { readFileSync } from 'node:fs';
import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

let cached: Record<string, unknown> | null = null;

export function loadOpenApiDocument(): Record<string, unknown> {
  if (!cached) {
    // Resolves to <project root>/openapi.yaml from both src/ and dist/.
    const file = new URL('../openapi.yaml', import.meta.url);
    cached = YAML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
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
