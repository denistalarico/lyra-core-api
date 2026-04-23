// src/database/run-migrations.ts
import 'reflect-metadata';
import { AppDataSource } from './typeorm.datasource';

async function run() {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
  console.log('Migrations executed successfully.');
}

run().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});
