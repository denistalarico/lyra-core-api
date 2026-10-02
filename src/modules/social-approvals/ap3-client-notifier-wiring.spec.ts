import { Module, type OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationEventProcessorService } from '../notifications/services';
import {
  ClientApprovalNotifierRegistry,
} from './client-approval-notifier.port';
import { ClientConversationCardRegistry } from './client-conversation-card.port';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';

/**
 * The token AP3 used, declared here rather than imported: the port no longer
 * exports it, because NTF-C1 replaced it with a registry. Keeping the literal
 * preserves this file as the regression that pins *why*.
 */
const CLIENT_APPROVAL_NOTIFIER = 'CLIENT_APPROVAL_NOTIFIER';

/**
 * NTF-C1 §1 — does `CLIENT_APPROVAL_NOTIFIER` actually resolve at runtime?
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * CCOM2 §24.1 proved that Nest resolves a provider's dependencies in the module
 * that **declares** the provider, and recorded as inherited debt that AP3's
 * `CLIENT_APPROVAL_NOTIFIER` has exactly the shape it proved does not work:
 * `@Optional() @Inject(TOKEN)` in `SocialApprovalNotificationPublisher`
 * (declared by `SocialApprovalsModule`) against a `provide:` in
 * `ClientAreaApprovalsModule` — a different module.
 *
 * NTF-C1 is not allowed to assume that finding. It reproduces the real module
 * topology, with no stand-ins for the part under test: the publisher is
 * declared by one module, the token is bound by another that imports it, and
 * the publisher is then resolved and asked to publish a client event.
 *
 * What this asserts is the *current* behaviour, so it documents the live
 * production defect. The replacement path is covered by the client-surface
 * specs; this file stays as the regression that pins the DI rule itself.
 */
describe('AP3 CLIENT_APPROVAL_NOTIFIER resolution', () => {
  const publishedTypes: string[] = [];

  const notifierStub = {
    publish: async (type: string) => {
      publishedTypes.push(type);
    },
  };

  /** Stands in for `SocialApprovalsModule`: declares the publisher. */
  @Module({
    providers: [
      SocialApprovalNotificationPublisher,
      ClientConversationCardRegistry,
      { provide: NotificationEventProcessorService, useValue: { process: async () => undefined } },
    ],
    exports: [SocialApprovalNotificationPublisher],
  })
  class DomainModule {}

  /**
   * Stands in for `ClientAreaApprovalsModule`: imports the domain and binds the
   * port, exactly as `client-approvals.module.ts` does today.
   */
  @Module({
    imports: [DomainModule],
    providers: [{ provide: CLIENT_APPROVAL_NOTIFIER, useValue: notifierStub }],
  })
  class ClientSurfaceModule {}

  beforeEach(() => {
    publishedTypes.length = 0;
  });

  it('boots without error even though the token is bound in another module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClientSurfaceModule],
    }).compile();

    // No boot failure: this is precisely what makes the defect silent.
    expect(moduleRef.get(SocialApprovalNotificationPublisher, { strict: false })).toBeDefined();
  });

  it('injects the cross-module token as undefined', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClientSurfaceModule],
    }).compile();

    const publisher = moduleRef.get(SocialApprovalNotificationPublisher, {
      strict: false,
    });

    // The private field the publisher guards on with `if (!this.clientNotifications) return;`
    const injected = (publisher as unknown as { clientNotifications?: unknown })
      .clientNotifications;

    expect(injected).toBeUndefined();
  });

  it('drops a client awaiting_client publication on the floor, silently', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClientSurfaceModule],
    }).compile();

    const publisher = moduleRef.get(SocialApprovalNotificationPublisher, {
      strict: false,
    });

    await publisher.publishClientOnly(
      'awaiting_client',
      { id: 'approval-1', tenantId: 't1' } as never,
    );

    // The bound notifier was never reached, and nothing threw.
    expect(publishedTypes).toEqual([]);
  });

  /**
   * NTF-C1 §2 — the regression that fails on the old design.
   *
   * Same module topology: the publisher declared by one module, the
   * implementation supplied by another that imports it. The only difference is
   * the registry, and that difference is the whole fix — so this assertion
   * cannot pass with an injection token, which is what makes it a regression
   * test rather than a restatement.
   */
  describe('the NTF-C1 registry replacement', () => {
    /** Stands in for `SocialApprovalsModule`, with the registry. */
    @Module({
      providers: [
        SocialApprovalNotificationPublisher,
        ClientConversationCardRegistry,
        ClientApprovalNotifierRegistry,
        {
          provide: NotificationEventProcessorService,
          useValue: { process: async () => undefined },
        },
      ],
      exports: [
        SocialApprovalNotificationPublisher,
        ClientApprovalNotifierRegistry,
      ],
    })
    class RegistryDomainModule {}

    /** Stands in for `ClientAreaApprovalsModule`, filling it on init. */
    @Module({ imports: [RegistryDomainModule] })
    class RegistrySurfaceModule implements OnModuleInit {
      constructor(private readonly registry: ClientApprovalNotifierRegistry) {}
      onModuleInit(): void {
        this.registry.register(notifierStub);
      }
    }

    it('delivers awaiting_client to the client pipeline', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [RegistrySurfaceModule],
      }).compile();
      // `init()` is what runs `onModuleInit`, i.e. the handoff itself.
      await moduleRef.init();

      const publisher = moduleRef.get(SocialApprovalNotificationPublisher, {
        strict: false,
      });

      await publisher.publishClientOnly(
        'awaiting_client',
        { id: 'approval-1', tenantId: 't1' } as never,
      );

      expect(publishedTypes).toEqual(['awaiting_client']);
    });

    it('reports an unfilled registry instead of failing silently', () => {
      expect(new ClientApprovalNotifierRegistry().get()).toBeNull();
    });
  });
});
