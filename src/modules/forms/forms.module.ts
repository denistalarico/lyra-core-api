import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { FormEmailSyncStateEntity } from './entities/form-email-sync-state.entity';
import { FormSubmissionEntity } from './entities/form-submission.entity';
import { FormEntity } from './entities/form.entity';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormEmailAiExtractor } from './services/form-email-ai.extractor';
import { FormEmailImapGateway } from './services/form-email-imap.gateway';
import { FormGoogleAdsLeadsService } from './services/form-google-ads-leads.service';
import { FormInboundEmailService } from './services/form-inbound-email.service';
import { FormLeadContactResolver } from './services/form-lead-contact.resolver';
import { FormLeadIngestionService } from './services/form-lead-ingestion.service';
import { FormsAddonService } from './services/forms-addon.service';
import { FormsService } from './services/forms.service';

/**
 * Forms addon — F1–F4 backend (2026-11-17).
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md
 */
@Module({
  imports: [
    PermissionsModule,
    CrmModule,
    AgencySalesModule,
    AgencySettingsModule,
    AiCostsModule,
    EmailModule,
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
      ],
      'agency',
    ),
  ],
  controllers: [FormsController, PublicFormsController],
  providers: [
    FormsService,
    FormsAddonService,
    FormLeadIngestionService,
    FormLeadContactResolver,
    FormInboundEmailService,
    FormGoogleAdsLeadsService,
    FormEmailImapGateway,
    FormEmailAiExtractor,
    SettingsCryptoService,
  ],
  exports: [FormsService, FormsAddonService],
})
export class FormsModule {}
