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
import { TelemetryContributionRegistry } from './services/telemetry-contribution.port';

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
  providers: [LeadFlowTelemetryPrivacyService, TelemetryContributionRegistry],
  // The registry is exported so a contributing domain can import this module
  // and register itself. The arrow points into privacy, never out of it.
  exports: [LeadFlowTelemetryPrivacyService, TelemetryContributionRegistry],
})
export class LeadFlowPrivacyModule {}
