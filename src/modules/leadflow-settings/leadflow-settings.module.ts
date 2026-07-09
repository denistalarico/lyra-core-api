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

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        AgencyClient,
        LeadFlowBusinessModeTemplateEntity,
        LeadFlowClientSettingsEntity,
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
  ],
  exports: [LeadFlowBusinessModeTemplateService, LeadFlowClientSettingsService],
})
export class LeadFlowSettingsModule {}
