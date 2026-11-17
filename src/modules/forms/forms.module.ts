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
import { CrmModule } from '../crm/crm.module';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { PermissionsModule } from '../permissions';
import { FormSubmissionEntity } from './entities/form-submission.entity';
import { FormEntity } from './entities/form.entity';
import { FormsController } from './forms.controller';
import { PublicFormsController } from './public-forms.controller';
import { FormLeadContactResolver } from './services/form-lead-contact.resolver';
import { FormLeadIngestionService } from './services/form-lead-ingestion.service';
import { FormsAddonService } from './services/forms-addon.service';
import { FormsService } from './services/forms.service';

/**
 * Forms addon — F1 backend (2026-11-17).
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md
 */
@Module({
  imports: [
    PermissionsModule,
    CrmModule,
    AgencySalesModule,
    AgencySettingsModule,
    TypeOrmModule.forFeature(
      [
        FormEntity,
        FormSubmissionEntity,
        CrmOpportunityEntity,
        AgencySalesOpportunityEntity,
        AgencySalesPipelineEntity,
        AgencySalesStageEntity,
        ContactEntity,
        ContactMethodEntity,
        ContactListEntity,
        ContactListMemberEntity,
        LeadFlowContactCompanyEntity,
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
  ],
  exports: [FormsService, FormsAddonService],
})
export class FormsModule {}
