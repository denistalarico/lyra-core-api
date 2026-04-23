// src/database/typeorm.datasource.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserPreferencesEntity } from '../modules/settings/entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from '../modules/settings/entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from '../modules/settings/entities/workspace-settings-company.entity';
import { CreateSettingsTables1760000000000 } from './migrations/1760000000000-create-settings-tables';
import { AddCompanyBrandAssets1760000001000 } from './migrations/1760000001000-add-company-brand-assets';
import { AlterCompanyBrandLogoUrlToText1760000002000 } from './migrations/1760000002000-alter-company-brand-logo-url-to-text';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME ?? 'lyra',
  password: process.env.DB_PASSWORD ?? 'lyra_dev_password',
  database: process.env.DB_NAME ?? 'lyra_core',
  synchronize: false,
  logging: false,
  entities: [
    UserPreferencesEntity,
    WorkspaceSettingsAiEntity,
    WorkspaceSettingsCompanyEntity,
  ],
  migrations: [
    CreateSettingsTables1760000000000,
    AddCompanyBrandAssets1760000001000,
    AlterCompanyBrandLogoUrlToText1760000002000,
  ],
});
