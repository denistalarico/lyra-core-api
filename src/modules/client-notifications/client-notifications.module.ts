import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyUserSecuritySettingsEntity } from '../agency/entities/agency-auth.entities';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import { ClientConversationsModule } from '../client-conversations/client-conversations.module';
import { ClientConversationsGateway } from '../client-conversations/gateways/client-conversations.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClientNotificationSurfaceRegistry } from '../notifications/ports/client-notification-surface.port';
import { NotificationRealtimeService } from '../notifications/services';
import { ClientNotificationsController } from './controllers/client-notifications.controller';
import { ClientNotificationSurfaceService } from './services/client-notification-surface.service';
import { ClientNotificationsService } from './services/client-notifications.service';

/**
 * NTF-C1 — the join between the Notifications Core and the Client Area.
 *
 * WHY A THIRD MODULE, AGAIN
 * -------------------------
 * Both sides need something from the other and neither may import the other:
 *
 *   core → client area   resolve the client audience, and its email addresses
 *   client area → core   read the feed, mark read, register push
 *
 * `NotificationsModule` cannot import `ClientAreaModule`: sixteen modules
 * import the core (Finance, Projects, Inbox, Team Chat, …) and every one of
 * them would inherit the Client Area authentication stack and its ESM
 * `otplib` dependency. So the core declares registries, provides them itself,
 * and this module fills them — the CCOM2 pattern, reused rather than
 * re-litigated.
 *
 * WHY NOT INJECTION TOKENS — THE WHOLE POINT OF THIS SPRINT
 * ---------------------------------------------------------
 * Because the alternative is *proved* broken, not merely suspected. AP3 bound
 * `CLIENT_APPROVAL_NOTIFIER` from a module other than the one declaring the
 * consumer; Nest resolves a provider's dependencies in its declaring module,
 * so the injection landed as `undefined` and every client approval email was
 * silently dropped from AP3 until now. `ap3-client-notifier-wiring.spec.ts`
 * reproduces it, and `ntf-c1-wiring.spec.ts` asserts that this handoff
 * actually happens.
 *
 * The registry's failure mode is the opposite: if this module is absent, the
 * core logs an error naming the event that reached no client recipient, and a
 * wiring spec fails. Loud, not silent.
 *
 * WHY THE REALTIME EMITTER IS THE CCOM1 GATEWAY
 * ---------------------------------------------
 * §17/§56 — `/client-area/realtime` is already the consolidated socket of this
 * surface, with the handshake (dedicated secret, `typ` claim, live session)
 * and the room derivation (from validated context, never from the payload)
 * that CCOM1 built. A `/client-area/notifications` namespace would duplicate
 * all of that for one event type and give the client a second socket to hold
 * open.
 */
@Module({
  imports: [
    /**
     * Each import is here for one thing:
     *
     *   NotificationsModule       the registry, the realtime service, the push
     *                             service and the recipient repository
     *   ClientAreaModule          eligibility, management and the guards
     *   ClientConversationsModule the `/client-area/realtime` gateway
     *
     * All three explicitly, because a module's exports are not transitive:
     * CCOM2 hit exactly that and it failed loudly at boot, which is the
     * failure mode worth having.
     */
    NotificationsModule,
    ClientAreaModule,
    ClientConversationsModule,
    TypeOrmModule.forFeature(
      [ClientAreaMembershipEntity, AgencyUserSecuritySettingsEntity],
      'agency',
    ),
  ],
  controllers: [ClientNotificationsController],
  providers: [ClientNotificationSurfaceService, ClientNotificationsService],
  exports: [ClientNotificationsService],
})
export class ClientNotificationsModule implements OnModuleInit {
  constructor(
    private readonly registry: ClientNotificationSurfaceRegistry,
    private readonly surface: ClientNotificationSurfaceService,
    private readonly realtime: NotificationRealtimeService,
    private readonly conversations: ClientConversationsGateway,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.surface);

    // §19 — `notification.created` on the Client Area namespace, carrying the
    // client-safe projection the core already built. The room is derived from
    // the validated ids, never from a payload (§18).
    this.realtime.registerClientEmitter((input) => {
      this.conversations.broadcastNotificationCreated(input);
    });
  }
}
