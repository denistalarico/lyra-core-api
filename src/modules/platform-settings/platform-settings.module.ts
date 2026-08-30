// src/modules/platform-settings/platform-settings.module.ts
//
// Neutral-of-product settings surface (Lyra Social S1.4.0). Deliberately not
// named after LeadFlow or Social — see
// docs/architecture/social/social-settings-decisions.md D-2.
//
// No entities and no TypeORM registration of its own: every read/write of
// `leadflow_client_settings` goes through `LeadFlowClientSettingsService`,
// imported here via `LeadFlowSettingsModule`'s exports. That is what keeps
// this module from becoming a second write path onto the same table.

import { Module } from '@nestjs/common';
import { LeadFlowSettingsModule } from '../leadflow-settings/leadflow-settings.module';
import { PermissionsModule } from '../permissions';
import { PlatformBusinessProfileController } from './platform-business-profile.controller';
import { PlatformBusinessProfileService } from './services/platform-business-profile.service';

@Module({
  imports: [PermissionsModule, LeadFlowSettingsModule],
  controllers: [PlatformBusinessProfileController],
  providers: [PlatformBusinessProfileService],
})
export class PlatformSettingsModule {}
