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
import { CreateDocumentLayouts1760001008000 } from './migrations/1760001008000-create-document-layouts';
import { EnhanceDocumentLayoutTemplates1760001009000 } from './migrations/1760001009000-enhance-document-layout-templates';
import { RefineDocumentLayoutTemplatesV31760001010000 } from './migrations/1760001010000-refine-document-layout-templates-v3';
import { CreateQuotesCore1760001007000 } from './migrations/1760001007000-create-quotes-core';
import { CreateAgencyCalendarCore1760001011000 } from './migrations/1760001011000-create-agency-calendar-core';
import { CreateAgencyCalendarSettings1760001012000 } from './migrations/1760001012000-create-agency-calendar-settings';
import { CreateAgencyProjectsTasksCore1760001013000 } from './migrations/1760001013000-create-agency-projects-tasks-core';
import { AddAgencyProjectSettings1760001014000 } from './migrations/1760001014000-add-agency-project-settings';
import { CreateAgencyProjectEvents1760001015000 } from './migrations/1760001015000-create-agency-project-events';
import { CreateAgencyActivitiesCore1760001016000 } from './migrations/1760001016000-create-agency-activities-core';
import { CreateAgencyFinanceCore1760002016000 } from './migrations/1760002016000-create-agency-finance-core';
import { CreateAgencyFinanceBillingCore1760002017000 } from './migrations/1760002017000-create-agency-finance-billing-core';
import { CreateAgencyFinanceDocumentSequences1760002018000 } from './migrations/1760002018000-create-agency-finance-document-sequences';
import { CreateAgencyFinanceFiscalProfile1760002019000 } from './migrations/1760002019000-create-agency-finance-fiscal-profile';
import { CreateAgencyFinancePaymentProviders1760002020000 } from './migrations/1760002020000-create-agency-finance-payment-providers';
import { CreateAgencyFinanceJournalEntries1760002021000 } from './migrations/1760002021000-create-agency-finance-journal-entries';

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
    CreateDocumentLayouts1760001008000,
    EnhanceDocumentLayoutTemplates1760001009000,
    RefineDocumentLayoutTemplatesV31760001010000,
    CreateQuotesCore1760001007000,
    CreateAgencyCalendarCore1760001011000,
    CreateAgencyCalendarSettings1760001012000,
    CreateAgencyProjectsTasksCore1760001013000,
    AddAgencyProjectSettings1760001014000,
    CreateAgencyProjectEvents1760001015000,
    CreateAgencyActivitiesCore1760001016000,
    CreateAgencyFinanceCore1760002016000,
    CreateAgencyFinanceBillingCore1760002017000,
    CreateAgencyFinanceDocumentSequences1760002018000,
    CreateAgencyFinanceFiscalProfile1760002019000,
    CreateAgencyFinancePaymentProviders1760002020000,
    CreateAgencyFinanceJournalEntries1760002021000,
  ],
});
