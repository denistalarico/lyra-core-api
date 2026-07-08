import 'reflect-metadata';
import { AgencyDataSource } from '../database/agency-typeorm.datasource';
import { LeadFlowBusinessModeTemplateEntity } from '../modules/leadflow-settings/entities';
import { LeadFlowBusinessModeTemplateSeederService } from '../modules/leadflow-settings/services/leadflow-business-mode-template-seeder.service';

async function run() {
  await AgencyDataSource.initialize();

  const service = new LeadFlowBusinessModeTemplateSeederService(
    AgencyDataSource.getRepository(LeadFlowBusinessModeTemplateEntity),
  );

  const summary = await service.seedOfficialTemplates();

  await AgencyDataSource.destroy();

  console.log('LeadFlow business mode seed executed.');
  console.log(`Created:              ${summary.created}`);
  console.log(`Updated:              ${summary.updated}`);
  console.log(`Official v1 templates: ${summary.officialVersionOneCount}`);
}

run().catch(async (error) => {
  console.error('LeadFlow business mode seed error:', error);

  if (AgencyDataSource.isInitialized) {
    await AgencyDataSource.destroy();
  }

  process.exit(1);
});
