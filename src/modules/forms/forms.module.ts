import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { AgencySalesModule } from '../agency/agency-sales.module';
import { AgencySettingsModule } from '../agency/agency-settings.module';
import {
  AgencySalesOpportunityEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from '../agency/entities/agency-sales.entities';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactListEntity } from '../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../contacts/entities/contact-list-member.entity';
import { ContactMethodEntity } from '../contacts/entities/contact-method.entity';
import { LeadFlowContactCompanyEntity } from '../contacts/entities/leadflow-contact-company.entity';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { AgencyWorkspaceEmailSettingsEntity } from '../agency/entities/agency-settings.entities';
import { AiCostsModule } from '../ai-costs/ai-costs.module';
import { CrmModule } from '../crm/crm.module';
import { EmailModule } from '../email/email.module';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { PermissionsModule } from '../permissions';
import { SocialAdEntity } from '../social-integrations/entities/social-ad-entity.entity';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { FormEmailSyncStateEntity } from './entities/form-email-sync-state.entity';
import { FormSubmissionEntity } from './entities/form-submission.entity';
import { GoogleAdsConversionUploadEntity } from './entities/google-ads-conversion-upload.entity';
import { GoogleAdsConversionUploadSettingsEntity } from './entities/google-ads-conversion-upload-settings.entity';
import { FormEntity } from './entities/form.entity';
import { FormsController } from './forms.controller';
import { GoogleAdsConversionUploadController } from './google-ads-conversion-upload.controller';
import { PublicFormsController } from './public-forms.controller';
import { SocialAnalyticsCrmController } from './social-analytics-crm.controller';
import { FormsLeadFactsReadService } from './services/forms-lead-facts.read.service';
import { SocialAnalyticsCrmReadService } from './services/social-analytics-crm.read.service';
import { FormEmailAiExtractor } from './services/form-email-ai.extractor';
import { FormEmailImapGateway } from './services/form-email-imap.gateway';
import { FormGoogleAdsLeadsImportService } from './services/form-google-ads-leads-import.service';
import { FormGoogleAdsLeadsService } from './services/form-google-ads-leads.service';
import { FormInboundEmailService } from './services/form-inbound-email.service';
import { FormLeadContactResolver } from './services/form-lead-contact.resolver';
import { FormLeadIngestionService } from './services/form-lead-ingestion.service';
import { FormMetaLeadsService } from './services/form-meta-leads.service';
import { FormsAddonService } from './services/forms-addon.service';
import { FormsService } from './services/forms.service';
import { GoogleAdsConversionUploadService } from './services/google-ads-conversion-upload.service';
import { GoogleAdsConversionUploadWorker } from './services/google-ads-conversion-upload.worker';

/**
 * Forms addon — F1–F4 backend (2026-11-17).
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md
 */
@Module({
  imports: [
    FilesModule,
    PermissionsModule,
    CrmModule,
    AgencySalesModule,
    AgencySettingsModule,
    AiCostsModule,
    EmailModule,
    // GL2: Google Ads lead import (reader, connection list, credential resolver).
    SocialIntegrationsModule,
    // ML1: Meta Lead Ads (Pages, Page token, Graph) and the `leadgen` relay.
    // One-way: nothing under social-organic imports FormsModule.
    SocialOrganicModule,
    TypeOrmModule.forFeature(
      [
        FormEntity,
        FormSubmissionEntity,
        FormEmailSyncStateEntity,
        AgencyWorkspaceEmailSettingsEntity,
        CrmOpportunityEntity,
        AgencySalesOpportunityEntity,
        AgencySalesPipelineEntity,
        AgencySalesStageEntity,
        ContactEntity,
        ContactMethodEntity,
        ContactListEntity,
        ContactListMemberEntity,
        LeadFlowContactCompanyEntity,
        SocialAdEntity,
        GoogleAdsConversionUploadSettingsEntity,
        GoogleAdsConversionUploadEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    FormsController,
    PublicFormsController,
    // GA-CONV: route under social/integrations/google, served from here.
    GoogleAdsConversionUploadController,
    // AN-CRM: "Leads e vendas" read under social/analytics, served from here.
    SocialAnalyticsCrmController,
  ],
  providers: [
    FormsService,
    FormsAddonService,
    FormLeadIngestionService,
    FormLeadContactResolver,
    FormInboundEmailService,
    FormGoogleAdsLeadsService,
    FormGoogleAdsLeadsImportService,
    FormMetaLeadsService,
    FormEmailImapGateway,
    FormEmailAiExtractor,
    SettingsCryptoService,
    GoogleAdsConversionUploadService,
    GoogleAdsConversionUploadWorker,
    FormsLeadFactsReadService,
    SocialAnalyticsCrmReadService,
  ],
  // AN-CRM (D-A1): `FormsLeadFactsReadService` is the read port for CRM
  // figures (aggregates only, no lead PII).
  exports: [FormsService, FormsAddonService, FormsLeadFactsReadService],
})
export class FormsModule {}
