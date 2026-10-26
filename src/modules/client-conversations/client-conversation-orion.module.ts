import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientAreaModule } from '../client-area/client-area.module';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { OrionModule } from '../orion/orion.module';
import { PermissionsModule } from '../permissions';
import { ClientConversationAssistantRegistry } from './client-conversation-assistant.port';
import { ClientConversationsModule } from './client-conversations.module';
import { ClientConversationOrionMentionService } from './services/client-conversation-orion-mention.service';

/**
 * OR7 — the join between Client Conversations and the Orion.
 *
 * A third module, as CCOM2 did for approvals: `ClientConversationsModule`
 * stays free of the Orion's graph (LeadFlow agents, Team Chat) and only
 * declares `ClientConversationAssistantRegistry`; this module imports both
 * sides and fills it. Each import is here for what the mention service uses:
 *
 *   ClientConversationsModule  conversations service, scope re-proof, gateways
 *                              and the registry
 *   OrionModule                `OrionService`, `OrionConfigService`
 *   ClientAreaModule           `ClientAreaManagementService` (company modules)
 *   PermissionsModule          `PlatformPermissionService` (Agency key)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AgencyClient], 'agency'),
    ClientConversationsModule,
    OrionModule,
    ClientAreaModule,
    PermissionsModule,
  ],
  providers: [ClientConversationOrionMentionService],
})
export class ClientConversationOrionModule implements OnModuleInit {
  constructor(
    private readonly registry: ClientConversationAssistantRegistry,
    private readonly mentions: ClientConversationOrionMentionService,
  ) {}

  onModuleInit(): void {
    this.registry.register((mention) => this.mentions.schedule(mention));
  }
}
