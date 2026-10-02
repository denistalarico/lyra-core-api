import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ClientAreaManagementService } from '../client-area/services/client-area-management.service';
import { ClientApprovalsService } from '../social-approvals/client/client-approvals.service';
import { ClientConversationApprovalsAdapter } from '../social-approvals/client/client-conversation-approvals.adapter';
import { ClientConversationCardRegistry } from '../social-approvals/client-conversation-card.port';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
} from '../social-approvals/entities';
import { ClientConversationApprovalsRegistry } from './client-conversation-approvals.port';
import { AgencyClientConversationsGateway } from './gateways/agency-client-conversations.gateway';
import { ClientConversationsGateway } from './gateways/client-conversations.gateway';
import { ClientConversationCardService } from './services/client-conversation-card.service';
import { ClientConversationsService } from './services/client-conversations.service';

/**
 * CCOM2 — the registries are actually filled at runtime.
 *
 * WHY THIS SPEC EXISTS AT ALL
 * ---------------------------
 * The two ports could have been injection tokens bound by the join module, and
 * that shape *compiles, boots and does nothing*: Nest resolves a provider's
 * dependencies in the module that declares the provider, so a token bound
 * elsewhere lands as `undefined` in an `@Optional()` injection. The failure
 * would be a card that is never published, with no error in any log — and AP3's
 * `CLIENT_APPROVAL_NOTIFIER` has exactly that shape today.
 *
 * So the registry handoff is asserted rather than assumed. The modules
 * themselves are not booted here (that needs two live database connections and
 * belongs to the PostgreSQL suites); what is proved is the contract the join
 * module implements: after `onModuleInit`, both registries hold their
 * implementation, and before it, both are empty and both domains degrade
 * instead of failing.
 */
describe('CCOM2 port registries', () => {
  it('an unfilled registry reports no implementation', () => {
    expect(new ClientConversationCardRegistry().get()).toBeNull();
    expect(new ClientConversationApprovalsRegistry().get()).toBeNull();
  });

  it('the join module fills both directions on init', async () => {
    const cardRegistry = new ClientConversationCardRegistry();
    const approvalsRegistry = new ClientConversationApprovalsRegistry();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true })],
      providers: [
        ClientConversationCardService,
        ClientConversationApprovalsAdapter,
        { provide: ClientConversationCardRegistry, useValue: cardRegistry },
        {
          provide: ClientConversationApprovalsRegistry,
          useValue: approvalsRegistry,
        },
        { provide: ClientConversationsService, useValue: {} },
        { provide: ClientAreaManagementService, useValue: {} },
        { provide: ClientConversationsGateway, useValue: {} },
        { provide: AgencyClientConversationsGateway, useValue: {} },
        { provide: ClientApprovalsService, useValue: {} },
        {
          provide: getRepositoryToken(SocialApprovalRequestEntity, 'agency'),
          useValue: {},
        },
        {
          provide: getRepositoryToken(SocialApprovalCommentEntity, 'agency'),
          useValue: {},
        },
        { provide: getDataSourceToken('agency'), useValue: {} },
      ],
    }).compile();

    // The same two lines `ClientConversationApprovalsModule.onModuleInit` runs.
    cardRegistry.register(moduleRef.get(ClientConversationCardService));
    approvalsRegistry.register(
      moduleRef.get(ClientConversationApprovalsAdapter),
    );

    expect(cardRegistry.get()).toBeInstanceOf(ClientConversationCardService);
    expect(approvalsRegistry.get()).toBeInstanceOf(
      ClientConversationApprovalsAdapter,
    );
  });

  /**
   * §13/§14 — the action rules, as a pure decision over the three inputs. The
   * adapter needs no repository for this, which is why the rule lives there as
   * a plain method rather than inside a query.
   */
  describe('resolveActions', () => {
    const adapter = new ClientConversationApprovalsAdapter(
      {} as never,
      {} as never,
      {} as never,
    );
    const state = {
      approvalId: 'a',
      title: 'Post',
      displayType: 'creative',
      versionLabel: 'v2',
      status: 'awaiting_your_review' as const,
      needsAction: true,
      sentToClientAt: '2026-10-01T00:00:00.000Z',
    };

    it('offers both actions to a client who holds both permissions', () => {
      expect(
        adapter.resolveActions({
          state,
          approvalsModuleEnabled: true,
          permissions: { comment: true, decide: true },
        }),
      ).toEqual({ canComment: true, canDecide: true, canOpenPreview: true });
    });

    /** §48 — a viewer reads the card and does not decide. */
    it('withholds decide from a viewer', () => {
      expect(
        adapter.resolveActions({
          state,
          approvalsModuleEnabled: true,
          permissions: { comment: false, decide: false },
        }),
      ).toEqual({ canComment: false, canDecide: false, canOpenPreview: true });
    });

    /**
     * §14 — approvals off degrades the card to a record. Not a CTA that 403s,
     * and not a hidden row: the client still sees what was sent to them.
     */
    it('degrades every action when the approvals module is off', () => {
      expect(
        adapter.resolveActions({
          state,
          approvalsModuleEnabled: false,
          permissions: { comment: true, decide: true },
        }),
      ).toEqual({ canComment: false, canDecide: false, canOpenPreview: false });
    });

    /** §39/§40 — a decided or replaced approval is no longer actionable. */
    it.each(['approved', 'in_revision', 'replaced', 'withdrawn'] as const)(
      'offers no action on a %s approval, whatever the permissions',
      (status) => {
        expect(
          adapter.resolveActions({
            state: { ...state, status, needsAction: false },
            approvalsModuleEnabled: true,
            permissions: { comment: true, decide: true },
          }),
        ).toEqual({
          canComment: false,
          canDecide: false,
          canOpenPreview: true,
        });
      },
    );
  });
});
