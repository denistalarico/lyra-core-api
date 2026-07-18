import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyClient } from '../clients/entities';
import { PermissionsModule } from '../permissions';
import {
  LeadFlowBusinessModeTemplateEntity,
  LeadFlowClientSettingsEntity,
} from './entities';
import { LeadFlowAgencySettingsController } from './leadflow-agency-settings.controller';
import { LeadFlowBusinessModesController } from './leadflow-business-modes.controller';
import { LeadFlowClientSettingsController } from './leadflow-client-settings.controller';
import { LeadFlowBusinessModeTemplateSeederService } from './services/leadflow-business-mode-template-seeder.service';
import { LeadFlowBusinessModeTemplateService } from './services/leadflow-business-mode-template.service';
import { LeadFlowClientSettingsService } from './services/leadflow-client-settings.service';
import { CompanyContextService } from './services/company-context.service';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        AgencyClient,
        LeadFlowBusinessModeTemplateEntity,
        LeadFlowClientSettingsEntity,
        InboxDomainOutboxEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    LeadFlowAgencySettingsController,
    LeadFlowBusinessModesController,
    LeadFlowClientSettingsController,
  ],
  providers: [
    LeadFlowBusinessModeTemplateService,
    LeadFlowBusinessModeTemplateSeederService,
    LeadFlowClientSettingsService,
    CompanyContextService,
  ],
  exports: [
    LeadFlowBusinessModeTemplateService,
    LeadFlowClientSettingsService,
    CompanyContextService,
  ],
})
export class LeadFlowSettingsModule {}
