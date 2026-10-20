/**
 * Seed script: pnpm seed [--sample]
 *  - connects to MONGODB_URI
 *  - builds/syncs all indexes
 *  - creates the default SiteConfig if missing
 *  - creates the first administrator from ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD if none exists
 *  - with --sample: inserts a few approved sample tributes (only if there are no tributes yet)
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/db/connection.js';
import { allModels, Tribute } from '../src/models/index.js';
import { bootstrapAdmin } from '../src/services/auth.js';
import { getSiteConfig } from '../src/services/siteConfig.js';
import { createLogger } from '../src/utils/logger.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger({ ...config, logLevel: 'info' });
  if (!config.mongodbUri) throw new Error('MONGODB_URI is required to seed the database');

  await connectDb(config, logger);
  for (const m of allModels) await m.syncIndexes();
  logger.info('Indexes synchronised');

  const site = await getSiteConfig();
  // Keep the living memorial identity in sync with the product default when still on the placeholder.
  if (site.grandmotherDisplayName === 'Grandmother') {
    site.grandmotherDisplayName = 'Serah Abeke Ibrahim';
    await site.save();
    logger.info({ grandmotherDisplayName: site.grandmotherDisplayName }, 'Updated grandmother display name');
  }
  logger.info('Site config ensured');

  const created = await bootstrapAdmin(config, logger);
  if (!created) {
    logger.info('No bootstrap admin created (an admin exists, or ADMIN_BOOTSTRAP_* is not set)');
  }

  if (process.argv.includes('--sample') && (await Tribute.estimatedDocumentCount()) === 0) {
    const now = new Date();
    const samples = [
      ['Mary Johnson', 'children', 'She taught me that kindness costs nothing and means everything. Every Sunday her kitchen was full of laughter.'],
      ['Daniel Okoro', 'grandchildren', 'Grandma always had a story and a warm plate waiting for me. I will carry her lessons my whole life.'],
      ['Ruth Adams', 'friends', 'For forty years she was the first person I called with good news and the last with bad. A true friend.'],
    ] as const;
    let order = 0;
    for (const [fullName, relationshipCategory, tributeText] of samples) {
      await Tribute.create({
        submissionId: randomUUID(),
        fullName,
        email: `sample-${order}@example.invalid`,
        relationshipCategory,
        tributeText,
        photoDisplayPermission: false,
        acknowledgment: true,
        status: 'approved',
        approvedAt: now,
        publishedAt: now,
        displayOrder: order++,
      });
    }
    logger.info({ count: samples.length }, 'Sample tributes inserted');
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
