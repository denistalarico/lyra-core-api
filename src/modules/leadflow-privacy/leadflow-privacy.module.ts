import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  LeadFlowProductTelemetryDailyEntity,
  LeadFlowTelemetryAuditEventEntity,
  LeadFlowTelemetryConsentEntity,
  LeadFlowTelemetryConsentNoticeEntity,
  LeadFlowTelemetryIdentityLinkEntity,
} from './entities';
import { PermissionsModule } from '../permissions';
import { LeadFlowPrivacyController } from './leadflow-privacy.controller';
import { LeadFlowTelemetryPrivacyService } from './services/leadflow-telemetry-privacy.service';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowProductTelemetryDailyEntity,
        LeadFlowTelemetryAuditEventEntity,
        LeadFlowTelemetryConsentEntity,
        LeadFlowTelemetryConsentNoticeEntity,
        LeadFlowTelemetryIdentityLinkEntity,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowPrivacyController],
  providers: [LeadFlowTelemetryPrivacyService],
  exports: [LeadFlowTelemetryPrivacyService],
})
export class LeadFlowPrivacyModule {}
