import 'reflect-metadata';
import { AgencyDataSource } from '../database/agency-typeorm.datasource';
import {
  HelpArticle,
  HelpCategory,
  HelpTrail,
  HelpTrailArticle,
} from '../modules/knowledge/help/entities';
import { HelpCenterSeedService } from '../modules/knowledge/help/help-center-seed.service';

/**
 * Idempotent seed of the official Help Center content.
 * Run with: pnpm agency:seed-help-center
 *
 * The content is also auto-synced on application bootstrap; this script exists
 * for explicit runs (CI, deploy hooks) and is safe to run repeatedly.
 */
async function run() {
  await AgencyDataSource.initialize();

  const service = new HelpCenterSeedService(
    AgencyDataSource.getRepository(HelpCategory),
    AgencyDataSource.getRepository(HelpTrail),
    AgencyDataSource.getRepository(HelpArticle),
    AgencyDataSource.getRepository(HelpTrailArticle),
  );

  const summary = await service.sync();

  await AgencyDataSource.destroy();

  console.log('Help Center seed executed successfully.');
  console.log(JSON.stringify(summary, null, 2));
}

run().catch(async (error) => {
  console.error('Help Center seed error:', error);

  if (AgencyDataSource.isInitialized) {
    await AgencyDataSource.destroy();
  }

  process.exit(1);
});
