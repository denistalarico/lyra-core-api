// src/modules/platform-privacy/platform-privacy.module.ts
//
// Neutral-of-product privacy surface (Lyra Social S1.4.8).
//
// No entities and no consent tables of its own: every read/write goes through
// `LeadFlowTelemetryPrivacyService`, imported from `LeadFlowPrivacyModule`'s
// exports. That is what keeps this from becoming a second consent store —
// the same discipline `PlatformSettingsModule` follows for the business
// profile (D-2/D-3).
//
// The one repository registered here is the notices table, used solely by the
// bootstrap seeder that writes the neutral notice row.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowPrivacyModule } from '../leadflow-privacy';
import { LeadFlowTelemetryConsentNoticeEntity } from '../leadflow-privacy/entities';
import { PermissionsModule } from '../permissions';
import { PlatformPrivacyController } from './platform-privacy.controller';
import { PlatformTelemetryNoticeSeedService } from './services/platform-telemetry-notice-seed.service';

@Module({
  imports: [
    PermissionsModule,
    LeadFlowPrivacyModule,
    TypeOrmModule.forFeature([LeadFlowTelemetryConsentNoticeEntity], 'agency'),
  ],
  controllers: [PlatformPrivacyController],
  providers: [PlatformTelemetryNoticeSeedService],
  exports: [PlatformTelemetryNoticeSeedService],
})
export class PlatformPrivacyModule {}
