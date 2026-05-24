import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { agencyEntities } from '../config/typeorm.config';
import { CreateAgencySettingsCore1760001000000 } from './migrations/1760001000000-create-agency-settings-core';
import { CreateAgencyEmailSettings1760001001000 } from './migrations/1760001001000-create-agency-email-settings';
import { CreateAgencySalesCore1760001002000 } from './migrations/1760001002000-create-agency-sales-core';
import { CreateAgencySalesOpportunityItems1760001003000 } from './migrations/1760001003000-create-agency-sales-opportunity-items';
import { CreateAgencySalesActivities1760001004000 } from './migrations/1760001004000-create-agency-sales-activities';
import { CreateContactsCore1760000015000 } from './migrations/1760000015000-create-contacts-core';
import { CreateContactsSettings1760000016000 } from './migrations/1760000016000-create-contacts-settings';
import { AddContactListParent1760000017000 } from './migrations/1760000017000-add-contact-list-parent';
import { AddAgencyContactListSystemFlags1760001005000 } from './migrations/1760001005000-add-agency-contact-list-system-flags';
import { CreateAgencyContactDetails1760001006000 } from './migrations/1760001006000-create-agency-contact-details';

export const AgencyDataSource = new DataSource({
  type: 'postgres',
  host: process.env.AGENCY_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.AGENCY_DB_PORT ?? process.env.DB_PORT ?? 5433),
  username: process.env.AGENCY_DB_USERNAME ?? process.env.DB_USERNAME ?? 'lyra',
  password:
    process.env.AGENCY_DB_PASSWORD ??
    process.env.DB_PASSWORD ??
    'lyra_dev_password',
  database: process.env.AGENCY_DB_NAME ?? 'lyra_agency',
  synchronize: false,
  logging: false,
  entities: agencyEntities,
  migrations: [
    CreateAgencySettingsCore1760001000000,
    CreateAgencyEmailSettings1760001001000,
    CreateAgencySalesCore1760001002000,
    CreateAgencySalesOpportunityItems1760001003000,
    CreateAgencySalesActivities1760001004000,
    CreateContactsCore1760000015000,
    CreateContactsSettings1760000016000,
    AddContactListParent1760000017000,
    AddAgencyContactListSystemFlags1760001005000,
    CreateAgencyContactDetails1760001006000,
  ],
});
