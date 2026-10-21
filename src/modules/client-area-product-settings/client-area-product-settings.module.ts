import { Module } from '@nestjs/common';
import { ClientAreaSettingsRegistryModule } from '../../common/client-area-bridge/client-area-settings.registry';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { LeadFlowSettingsModule } from '../leadflow-settings/leadflow-settings.module';
import { SocialIntegrationsModule } from '../social-integrations/social-integrations.module';
import { SocialOrganicModule } from '../social-organic/social-organic.module';
import { InboxModule } from '../inbox/inbox.module';
import { ClientAreaProductSettingsService } from './client-area-product-settings.service';

@Module({
  imports: [
    ClientAreaSettingsRegistryModule,
    PlatformSettingsModule,
    LeadFlowSettingsModule,
    SocialIntegrationsModule,
    SocialOrganicModule,
    InboxModule,
  ],
  providers: [ClientAreaProductSettingsService],
})
export class ClientAreaProductSettingsModule {}
