import 'reflect-metadata';
import { AgencyDataSource } from './agency-typeorm.datasource';

async function run() {
  await AgencyDataSource.initialize();
  await AgencyDataSource.runMigrations();
  await AgencyDataSource.destroy();
  console.log('Agency migrations executed successfully.');
}

run().catch((error) => {
  console.error('Agency migration error:', error);
  process.exit(1);
});
