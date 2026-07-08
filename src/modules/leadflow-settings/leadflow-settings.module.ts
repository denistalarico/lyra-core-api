import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  LeadFlowBusinessModeTemplateEntity,
  LeadFlowClientSettingsEntity,
} from './entities';
import { LeadFlowBusinessModeTemplateSeederService } from './services/leadflow-business-mode-template-seeder.service';
import { LeadFlowBusinessModeTemplateService } from './services/leadflow-business-mode-template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [LeadFlowBusinessModeTemplateEntity, LeadFlowClientSettingsEntity],
      'agency',
    ),
  ],
  providers: [
    LeadFlowBusinessModeTemplateService,
    LeadFlowBusinessModeTemplateSeederService,
  ],
  exports: [LeadFlowBusinessModeTemplateService],
})
export class LeadFlowSettingsModule {}
