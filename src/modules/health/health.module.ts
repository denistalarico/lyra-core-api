import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';

@Module({
  imports: [LeadFlowAgentsModule],
  controllers: [HealthController],
})
export class HealthModule {}
