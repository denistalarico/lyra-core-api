import { Module, type OnModuleInit } from '@nestjs/common';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaApprovalsModule } from '../social-approvals/client/client-approvals.module';
import { ClientConversationApprovalsAdapter } from '../social-approvals/client/client-conversation-approvals.adapter';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { ClientConversationCardRegistry } from '../social-approvals/client-conversation-card.port';
import { ClientConversationApprovalsRegistry } from './client-conversation-approvals.port';
import { ClientConversationsModule } from './client-conversations.module';
import { ClientConversationCardService } from './services/client-conversation-card.service';

/**
 * CCOM2 — the join between Client Conversations and Approvals.
 *
 * WHY A THIRD MODULE AND NOT AN IMPORT EITHER WAY
 * -----------------------------------------------
 * Both domains need something from the other:
 *
 *   approvals → conversations   publish the card when an approval is sent,
 *                               and announce timeline activity
 *   conversations → approvals   resolve a card's current state, project the
 *                               client-visible comments
 *
 * Wiring that as module imports is a genuine cycle, and `forwardRef` would only
 * hide it — the dependency really does run both ways. So each domain declares a
 * registry for what it needs, provides that registry itself, and this module
 * imports both sides and fills them. Neither domain imports the other.
 *
 * WHY REGISTRIES AND NOT INJECTION TOKENS
 * ---------------------------------------
 * Verified before choosing: Nest resolves a provider's dependencies in the
 * module that **declares** the provider, so a token bound here would not be in
 * `SocialApprovalNotificationPublisher`'s resolution context and its optional
 * injection would land as `undefined` — silently, with the card never
 * published and no error anywhere. A registry provided by the declaring module
 * always resolves; whether it is filled is what says the surface is wired.
 *
 * The consequence worth stating: with this module absent, both domains still
 * load and work. Conversations serve the CCOM1 timeline (messages only), and an
 * approval reaching `awaiting_client` notifies without posting a card.
 * Degradation, not breakage — which is what makes these ports honest rather
 * than decorative.
 */
/**
 * Both approvals modules are imported, and each for one thing:
 *
 *   ClientConversationsModule  the conversations service, both gateways and
 *                              `ClientConversationApprovalsRegistry`
 *   SocialApprovalsModule      `ClientConversationCardRegistry`, which it
 *                              declares so the publisher can resolve it
 *   ClientAreaApprovalsModule  `ClientApprovalsService`, the AP3 projection
 *                              the adapter reuses
 *   ClientAreaModule           `ClientAreaManagementService`, for the company's
 *                              module flags (§10)
 *
 * Every one of those is imported explicitly, because a module's exports are not
 * transitive unless re-exported: importing only `ClientAreaApprovalsModule`
 * leaves the registry out of this module's resolution context and the handoff
 * below fails to construct. That is a loud failure at boot rather than a silent
 * one — which is exactly why the registries are provided by their declaring
 * modules instead of bound here as tokens.
 */
@Module({
  imports: [
    ClientConversationsModule,
    SocialApprovalsModule,
    ClientAreaApprovalsModule,
    ClientAreaModule,
  ],
  providers: [
    ClientConversationCardService,
    ClientConversationApprovalsAdapter,
  ],
})
export class ClientConversationApprovalsModule implements OnModuleInit {
  constructor(
    private readonly cards: ClientConversationCardService,
    private readonly approvals: ClientConversationApprovalsAdapter,
    private readonly cardRegistry: ClientConversationCardRegistry,
    private readonly approvalsRegistry: ClientConversationApprovalsRegistry,
  ) {}

  onModuleInit(): void {
    this.cardRegistry.register(this.cards);
    this.approvalsRegistry.register(this.approvals);
  }
}
