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
 * Idempotent seed of the official Help Center content from the versioned
 * Markdown + JSON files under `content/help-center`.
 * Run with: pnpm agency:seed-help-center
 *
 * The content is also auto-synced on application bootstrap (same loader); this
 * script exists for explicit runs (CI, deploy hooks) and is safe to repeat.
 * Optional first arg selects the locale (defaults to pt-BR).
 */
async function run() {
  const locale = process.argv[2] ?? 'pt-BR';
  await AgencyDataSource.initialize();

  const service = new HelpCenterSeedService(
    AgencyDataSource.getRepository(HelpCategory),
    AgencyDataSource.getRepository(HelpTrail),
    AgencyDataSource.getRepository(HelpArticle),
    AgencyDataSource.getRepository(HelpTrailArticle),
  );

  const { summary, errors, warnings, sources } = await service.loadAndSync(locale);

  await AgencyDataSource.destroy();

  console.log('Help Center seed executed.');
  console.log(`Locale:        ${locale}`);
  console.log(`Content dir:   ${sources.contentDir}`);
  console.log(`Article files: ${sources.articleFiles.length}`);
  console.log('');
  console.log(
    `Categories:  created ${summary.categories.created}, updated ${summary.categories.updated}, skipped ${summary.categories.skipped}`,
  );
  console.log(
    `Trails:      created ${summary.trails.created}, updated ${summary.trails.updated}, skipped ${summary.trails.skipped}`,
  );
  console.log(
    `Articles:    created ${summary.articles.created}, updated ${summary.articles.updated}, skipped ${summary.articles.skipped}`,
  );
  console.log(`Missing from source (flagged): ${summary.missingFromSource}`);

  if (warnings.length) {
    console.log('');
    console.log(`Warnings (${warnings.length}):`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }

  if (errors.length) {
    console.log('');
    console.log(`Validation errors (${errors.length}):`);
    errors.forEach((e) => console.log(`  - ${e}`));
    process.exitCode = 1;
  }
}

run().catch(async (error) => {
  console.error('Help Center seed error:', error);

  if (AgencyDataSource.isInitialized) {
    await AgencyDataSource.destroy();
  }

  process.exit(1);
});
