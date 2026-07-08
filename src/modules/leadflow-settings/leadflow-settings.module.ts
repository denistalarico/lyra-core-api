import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  LeadFlowBusinessModeTemplateEntity,
  LeadFlowClientSettingsEntity,
} from './entities';
import { PermissionsModule } from '../permissions';
import { LeadFlowBusinessModesController } from './leadflow-business-modes.controller';
import { LeadFlowBusinessModeTemplateSeederService } from './services/leadflow-business-mode-template-seeder.service';
import { LeadFlowBusinessModeTemplateService } from './services/leadflow-business-mode-template.service';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [LeadFlowBusinessModeTemplateEntity, LeadFlowClientSettingsEntity],
      'agency',
    ),
  ],
  controllers: [LeadFlowBusinessModesController],
  providers: [
    LeadFlowBusinessModeTemplateService,
    LeadFlowBusinessModeTemplateSeederService,
  ],
  exports: [LeadFlowBusinessModeTemplateService],
})
export class LeadFlowSettingsModule {}
