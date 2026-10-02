import { DataSource } from 'typeorm';
import {
  NotificationActionType,
  NotificationActorType,
  NotificationAudience,
  NotificationCategory,
  NotificationDefaultDelivery,
  NotificationDeliveryChannel,
  NotificationInterestReason,
  NotificationPreferencePolicy,
  NotificationPriority,
  NotificationProductKey,
  NotificationRecipientStrategy,
  NotificationRecipientSurface,
  NotificationSelfPolicy,
} from '../enums';
import { ClientNotificationSurfaceRegistry } from '../ports/client-notification-surface.port';
import { NotificationEventProcessorService } from './notification-event-processor.service';
import type { NotificationRealtimeService } from './notification-realtime.service';

/**
 * NTF-C1 §4–§7, §25, §42, §44, §54 — the surface dimension of the processor.
 *
 * Kept separate from `notification-event-processor.service.spec.ts`, which is
 * the Agency regression suite (§55) and must keep asserting exactly what it
 * asserted before this sprint. This file covers only what the surface adds.
 */

type Options = {
  audience?: NotificationAudience;
  agencyRecipients?: { userId: string; interestReason: string }[];
  clientAudience?: {
    userId: string;
    membershipId: string;
    companyContextId: string;
    email: string | null;
  }[];
  surfaceWired?: boolean;
  workspaceUsers?: { userId: string; email: string }[];
  preferenceRows?: unknown[];
};

function build(options: Options = {}) {
  const saved: {
    notification: Record<string, unknown> | null;
    recipients: Record<string, unknown>[];
    deliveries: Record<string, unknown>[];
  } = { notification: null, recipients: [], deliveries: [] };

  /** Lets a test make the next `process()` find an already-stored row. */
  let existingRow: Record<string, unknown> | null = null;
  const existing = {
    set(row: Record<string, unknown>) {
      existingRow = row;
    },
  };

  const notification = {
    findOne: jest.fn(async () => existingRow),
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => {
      saved.notification = input;
      return {
        ...input,
        id: 'notification-1',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      };
    }),
  };
  const recipient = {
    create: jest.fn((input) => input),
    save: jest.fn(async (inputs: Record<string, unknown>[]) => {
      const rows = inputs.map((input, index) => ({
        ...input,
        id: `recipient-${index + 1}`,
      }));
      saved.recipients = rows;
      return rows;
    }),
  };
  const delivery = {
    create: jest.fn((input) => input),
    save: jest.fn(async (inputs: Record<string, unknown>[]) => {
      const rows = inputs.map((input, index) => ({
        ...input,
        id: `delivery-${index + 1}`,
      }));
      saved.deliveries = rows;
      return rows;
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const dataSource = {
    transaction: jest.fn(async (runner: (manager: unknown) => unknown) =>
      runner({
        getRepository: (entity: { name: string }) => {
          if (entity.name === 'NotificationEntity') return notification;
          if (entity.name === 'NotificationRecipientEntity') return recipient;
          if (entity.name === 'NotificationDeliveryEntity') return delivery;
          throw new Error(`Unexpected repository ${entity.name}`);
        },
      }),
    ),
    getRepository: jest.fn(() => delivery),
  } as unknown as DataSource;

  const definition = {
    eventType: 'social.approval.awaiting_client',
    productKey: NotificationProductKey.SOCIAL,
    moduleKey: 'approvals',
    category: NotificationCategory.APPROVAL,
    defaultPriority: NotificationPriority.NORMAL,
    defaultActionType: NotificationActionType.INTERNAL_ROUTE,
    recipientStrategy: NotificationRecipientStrategy.EXPLICIT_USERS,
    selfNotificationPolicy: NotificationSelfPolicy.SUPPRESS_ACTOR,
    preferencePolicy: NotificationPreferencePolicy.CONFIGURABLE,
    preferenceKey: 'social.approvals.approval',
    defaultDelivery: NotificationDefaultDelivery.ENABLED,
    required: false,
    groupable: false,
    audience: options.audience ?? NotificationAudience.BOTH,
  };

  const registry = new ClientNotificationSurfaceRegistry();
  if (options.surfaceWired !== false) {
    registry.register({
      resolveAudience: jest
        .fn()
        .mockResolvedValue(options.clientAudience ?? []) as never,
      revalidate: jest.fn().mockResolvedValue(null) as never,
    });
  }

  const pushService = {
    sendToUsers: jest.fn().mockResolvedValue(new Map()),
  };
  const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const realtime = {
    emitCreatedForRecipient: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<NotificationRealtimeService>;

  const preferencesRepo = {
    find: jest.fn().mockResolvedValue(options.preferenceRows ?? []),
  };

  const service = new NotificationEventProcessorService(
    dataSource,
    preferencesRepo as never,
    {
      find: jest.fn().mockResolvedValue(options.workspaceUsers ?? []),
    } as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { requireDefinition: jest.fn(() => definition) } as never,
    {
      resolve: jest.fn(() => options.agencyRecipients ?? []),
    } as never,
    // The real policy is exercised by its own suite; here it passes through so
    // this file asserts the surface merge rather than the policy.
    { apply: jest.fn((_event, recipients) => recipients) } as never,
    realtime,
    emailService as never,
    { decrypt: jest.fn() } as never,
    { get: jest.fn(() => undefined) } as never,
    pushService as never,
    registry,
  );

  return {
    service,
    saved,
    existing,
    pushService,
    emailService,
    preferencesRepo,
    realtime,
    registry,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'social.approval.awaiting_client:approval-1:2026',
    eventType: 'social.approval.awaiting_client',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    productKey: NotificationProductKey.SOCIAL,
    moduleKey: 'approvals',
    actorType: NotificationActorType.USER,
    actorUserId: 'operator-1',
    occurredAt: '2026-03-01T00:00:00.000Z',
    payload: { title: 'Aprovação', body: 'Corpo' },
    clientAudience: {
      companyContextId: 'company-a',
      requiredPermission: 'client_area.approvals.view',
      requiredModule: 'approvals',
      interestReason: NotificationInterestReason.APPROVER,
      actionUrl: '/client-area/companies/company-a/approvals/approval-1',
      title: 'Uma aprovação aguarda você',
      body: 'Algo aguarda você.',
    },
    ...overrides,
  } as never;
}

describe('notification recipient surfaces', () => {
  it('writes the surface explicitly on every recipient', async () => {
    const { service, saved } = build({
      agencyRecipients: [
        {
          userId: 'operator-2',
          interestReason: NotificationInterestReason.REQUESTER,
        },
      ],
      clientAudience: [
        {
          userId: 'client-1',
          membershipId: 'm1',
          companyContextId: 'company-a',
          email: 'c@example.com',
        },
      ],
    });

    await service.process(makeEvent());

    expect(
      saved.recipients.map((row) => [row.userId, row.recipientSurface]),
    ).toEqual([
      ['operator-2', NotificationRecipientSurface.AGENCY],
      ['client-1', NotificationRecipientSurface.CLIENT_AREA],
    ]);
  });

  /**
   * §44 — the case the unique index had to change for. One human, two roles,
   * one notification: two recipient rows that must not collide and must not
   * merge.
   */
  it('keeps the same identity as two recipients on two surfaces', async () => {
    const { service, saved } = build({
      agencyRecipients: [
        {
          userId: 'dual-identity',
          interestReason: NotificationInterestReason.REQUESTER,
        },
      ],
      clientAudience: [
        {
          userId: 'dual-identity',
          membershipId: 'm1',
          companyContextId: 'company-a',
          email: 'dual@example.com',
        },
      ],
    });

    const result = await service.process(makeEvent());

    expect(result.recipientCount).toBe(2);
    expect(saved.recipients.map((row) => row.recipientSurface)).toEqual([
      NotificationRecipientSurface.AGENCY,
      NotificationRecipientSurface.CLIENT_AREA,
    ]);
    // Same person, so the only thing distinguishing the rows is the surface.
    expect(new Set(saved.recipients.map((row) => row.userId))).toEqual(
      new Set(['dual-identity']),
    );
  });

  describe('audience gating (§6)', () => {
    it('drops client recipients when the definition is Agency-only', async () => {
      const { service, saved, registry } = build({
        audience: NotificationAudience.AGENCY,
        agencyRecipients: [
          {
            userId: 'operator-2',
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'c@example.com',
          },
        ],
      });

      await service.process(makeEvent());

      expect(saved.recipients.map((row) => row.userId)).toEqual(['operator-2']);
      // The surface is not even consulted: gating happens before resolution.
      expect(registry.get()!.resolveAudience).not.toHaveBeenCalled();
    });

    it('drops Agency recipients when the definition is client-only', async () => {
      const { service, saved } = build({
        audience: NotificationAudience.CLIENT_AREA,
        agencyRecipients: [
          {
            userId: 'operator-2',
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'c@example.com',
          },
        ],
      });

      await service.process(makeEvent());

      expect(saved.recipients.map((row) => row.userId)).toEqual(['client-1']);
    });
  });

  /**
   * §48 — an unwired surface produces an `error` log naming the event, and a
   * `skipped` result. The contrast with AP3 is the whole point: there, the
   * same condition produced a successful-looking no-op.
   */
  it('reports and skips when the client surface is not wired', async () => {
    const { service } = build({
      audience: NotificationAudience.CLIENT_AREA,
      surfaceWired: false,
    });
    const errorSpy = jest
      .spyOn(
        Object.getPrototypeOf(
          (service as unknown as { logger: object }).logger,
        ) as { error: (...args: unknown[]) => void },
        'error',
      )
      .mockImplementation(() => undefined);

    const result = await service.process(makeEvent());

    expect(result).toMatchObject({
      status: 'skipped',
      reason: 'no_recipients',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('not wired'),
    );
    errorSpy.mockRestore();
  });

  it('resolves no client recipient without a client audience on the event', async () => {
    const { service, registry } = build({
      clientAudience: [
        {
          userId: 'client-1',
          membershipId: 'm1',
          companyContextId: 'company-a',
          email: 'c@example.com',
        },
      ],
    });

    await service.process(makeEvent({ clientAudience: undefined }));

    expect(registry.get()!.resolveAudience).not.toHaveBeenCalled();
  });

  describe('channels per surface (§33)', () => {
    it('gives a client recipient in-app and email without an Agency preference row', async () => {
      const { service, saved } = build({
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'c@example.com',
          },
        ],
      });

      await service.process(makeEvent());

      const channels = saved.deliveries.map((row) => row.channel);
      expect(channels).toContain(NotificationDeliveryChannel.IN_APP);
      // AP3 mailed these unconditionally; §33 forbids silently turning that
      // off while migrating the pipeline.
      expect(channels).toContain(NotificationDeliveryChannel.EMAIL);
    });

    /**
     * No address means no email channel — and, importantly, the in-app feed
     * still works. A client without a usable email is still notified.
     */
    it('creates no email delivery for a client recipient with no address', async () => {
      const { service, saved } = build({
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: null,
          },
        ],
      });

      await service.process(makeEvent());

      const channels = saved.deliveries.map((row) => row.channel);
      expect(channels).not.toContain(NotificationDeliveryChannel.EMAIL);
      expect(channels).toContain(NotificationDeliveryChannel.IN_APP);
    });

    /**
     * §32 — the preferences model is `(tenant_id, user_id)` + a JSONB array in
     * `modules/settings`, with no surface dimension. NTF-C1 does not add one,
     * and does not need to: an Agency preference row is never consulted for a
     * client recipient, so the two surfaces cannot read each other's settings
     * even though they share an id space. Asserted rather than assumed,
     * because the shared id space is what would make the mistake invisible.
     */
    it('never reads Agency preferences for a client recipient', async () => {
      const { service, preferencesRepo } = build({
        audience: NotificationAudience.CLIENT_AREA,
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'c@example.com',
          },
        ],
      });

      await service.process(makeEvent());

      for (const call of preferencesRepo.find.mock.calls) {
        const userIds = call[0]?.where?.userId?._value ?? [];
        expect(userIds).not.toContain('client-1');
      }
    });

    it('does not give an Agency recipient email just because a client got one', async () => {
      const { service, saved } = build({
        agencyRecipients: [
          {
            userId: 'operator-2',
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'c@example.com',
          },
        ],
        // No workspace_users row and no preference row: Agency email stays off.
        workspaceUsers: [],
      });

      await service.process(makeEvent());

      const agencyRecipientId = saved.recipients.find(
        (row) => row.recipientSurface === NotificationRecipientSurface.AGENCY,
      )!.id;
      const agencyChannels = saved.deliveries
        .filter((row) => row.notificationRecipientId === agencyRecipientId)
        .map((row) => row.channel);

      expect(agencyChannels).toEqual([NotificationDeliveryChannel.IN_APP]);
    });
  });

  /**
   * §25 — the isolation that stops a client notification appearing in the
   * browser someone is logged into as an Agency operator.
   */
  describe('push fan-out per surface (§25)', () => {
    it('sends each surface only to its own subscriptions', async () => {
      const { service, pushService } = build({
        agencyRecipients: [
          {
            userId: 'dual-identity',
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
        clientAudience: [
          {
            userId: 'dual-identity',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'dual@example.com',
          },
        ],
        // Agency push requires an explicit opt-in, keyed by the event type
        // (the processor's exact-match lookup); the client surface is
        // subscription-driven instead.
        preferenceRows: [
          {
            userId: 'dual-identity',
            preferences: [
              { key: 'social.approval.awaiting_client', push: true },
            ],
          },
        ],
      });

      await service.process(makeEvent());

      const surfaces = pushService.sendToUsers.mock.calls.map(
        (call) => call[3],
      );
      expect(surfaces).toEqual([
        NotificationRecipientSurface.AGENCY,
        NotificationRecipientSurface.CLIENT_AREA,
      ]);
    });

    it('opens a Client Area route in a client push, never an Agency one', async () => {
      const { service, pushService } = build({
        clientAudience: [
          {
            userId: 'client-1',
            membershipId: 'm1',
            companyContextId: 'company-a',
            email: 'c@example.com',
          },
        ],
      });

      await service.process(
        makeEvent({
          payload: {
            title: 'Aprovação',
            body: 'Corpo',
            actionUrl: '/social/approvals?approvalId=approval-1',
          },
        }),
      );

      const [, , payload, surface] = pushService.sendToUsers.mock.calls[0];
      expect(surface).toBe(NotificationRecipientSurface.CLIENT_AREA);
      expect(payload.url).toContain(
        '/client-area/companies/company-a/approvals/approval-1',
      );
      expect(payload.url).not.toContain('/social/approvals');
    });
  });

  /**
   * §16/§43 — one notification row serves both audiences, so it cannot hold a
   * single action URL: `action_url` keeps the Agency route and the client
   * route travels in metadata, where only the client projection reads it.
   */
  it('records the client route and company on the notification', async () => {
    const { service, saved } = build({
      clientAudience: [
        {
          userId: 'client-1',
          membershipId: 'm1',
          companyContextId: 'company-a',
          email: 'c@example.com',
        },
      ],
    });

    await service.process(
      makeEvent({
        payload: {
          title: 'Aprovação',
          body: 'Corpo',
          actionUrl: '/social/approvals?approvalId=approval-1',
        },
      }),
    );

    expect(saved.notification).toMatchObject({
      actionUrl: '/social/approvals?approvalId=approval-1',
      metadata: expect.objectContaining({
        companyContextId: 'company-a',
        clientActionUrl:
          '/client-area/companies/company-a/approvals/approval-1',
        clientTitle: 'Uma aprovação aguarda você',
      }),
    });
  });

  /**
   * §11/§26 — a retried event finds the existing notification and stops. The
   * client pipeline inherits that unchanged, which is the point of it no
   * longer having an idempotency story of its own.
   */
  it('is idempotent: a replayed source event creates no second recipient', async () => {
    const { service, saved, existing } = build({
      clientAudience: [
        {
          userId: 'client-1',
          membershipId: 'm1',
          companyContextId: 'company-a',
          email: 'c@example.com',
        },
      ],
    });

    const first = await service.process(makeEvent());
    expect(first.status).toBe('created');
    const firstRecipientCount = saved.recipients.length;

    // The row the first call would have written is now found by the second.
    existing.set({
      id: 'notification-1',
      recipients: saved.recipients,
    });

    const second = await service.process(makeEvent());

    expect(second.status).toBe('duplicate');
    expect(saved.recipients).toHaveLength(firstRecipientCount);
  });
});
