// Vercel serverless entrypoint (Node.js runtime).
// `pnpm build` compiles src/ to dist/ (see vercel.json buildCommand); this file just re-exports the Express app.
// Express apps are valid Node request handlers, so the default export is used directly.
import { createApp } from '../dist/app.js';

let app;
try {
  app = createApp();
} catch (err) {
  // Fail loudly and clearly if configuration is invalid (e.g. missing MONGODB_URI in production).
  console.error(err instanceof Error ? err.message : err);
  app = (_req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'MISCONFIGURED', message: 'Server configuration is invalid' } }));
  };
}

export default app;
