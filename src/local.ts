import 'dotenv/config';
import { createApp } from './createApp.js';
import { ConfigError, loadConfig } from './config/env.js';
import { connectDb, disconnectDb } from './db/connection.js';
import { bootstrapAdmin } from './services/auth.js';
import { createLogger } from './utils/logger.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const logger = createLogger(config);

  if (!config.mongodbUri) {
    logger.error('MONGODB_URI is not set. Set it (see .env.example) before starting the server.');
    process.exit(1);
  }

  await connectDb(config, logger);
  await bootstrapAdmin(config, logger);

  const app = createApp({ config, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'House of Memories API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
