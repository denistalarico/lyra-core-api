import { ClientApprovalNotificationService } from './client-approval-notification.service';
import type { SocialApprovalRequestEntity } from '../entities';
import type { NotificationSourceEvent } from '../../notifications/types';

/**
 * AP3 §67 / NTF-C1 §10/§22/§23 — the client approval notifier, after the
 * pipeline migration.
 *
 * WHAT MOVED, AND WHERE THESE ASSERTIONS WENT
 * -------------------------------------------
 * AP3's version of this suite asserted recipient resolution (active
 * membership + `approvals.view` + CRM eligibility, never a Contact) and email
 * delivery against a ledger. Those rules did not disappear — they moved into
 * `ClientNotificationSurfaceService`, and they are asserted there
 * (`client-notification-surface.service.spec.ts`), against the same cases.
 *
 * What remains this service's own responsibility, and therefore this file's:
 * *which* events reach the client at all, the Client Area action URL, the
 * source-event identity that carries the idempotency, and that a failure never
 * propagates into the approval transition.
 */

const approval = {
  id: 'approval-1',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
  title: 'Post de lançamento',
  subjectVersionLabel: 'r2',
  status: 'awaiting_client',
  sentToClientAt: new Date('2026-01-02T10:00:00.000Z'),
  supersededAt: null,
  cancelledAt: new Date('2026-01-03T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
} as unknown as SocialApprovalRequestEntity;

function build() {
  const events: NotificationSourceEvent[] = [];
  const process = jest
    .fn()
    .mockImplementation((event: NotificationSourceEvent) => {
      events.push(event);
      return Promise.resolve({
        status: 'created',
        notificationId: 'n1',
        recipientCount: 1,
      });
    });

  const service = new ClientApprovalNotificationService({
    process,
  } as never);

  return { service, process, events };
}

describe('NTF-C1 client approval notifier publishes into the core', () => {
  it('publishes cancelled with a client audience and no Agency recipient', async () => {
    const { service, events } = build();

    await service.publish('cancelled', approval);

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.eventType).toBe('social.approval.cancelled');
    // Client-only: an Agency recipient here would put the operator's own
    // action in their own feed.
    expect(event.recipients).toEqual([]);
    expect(event.clientAudience).toMatchObject({
      companyContextId: 'company-a',
      requiredPermission: 'client_area.approvals.view',
      requiredModule: 'approvals',
    });
  });

  it('addresses the Client Area route and never the Agency one', async () => {
    const { service, events } = build();

    await service.publish('cancelled', approval);

    expect(events[0].clientAudience?.actionUrl).toBe(
      '/client-area/companies/company-a/approvals/approval-1',
    );
    expect(events[0].clientAudience?.actionUrl).not.toContain(
      '/social/approvals',
    );
  });

  /**
   * §11 — the core deduplicates on `(tenant_id, source_event_id)`, so the key
   * is where idempotency lives now. It is byte-for-byte AP3's, which keeps the
   * two eras correlatable and means a replayed event cannot produce a second
   * notification.
   */
  it('keys the event exactly as the AP3 ledger did', async () => {
    const { service, events } = build();

    await service.publish('cancelled', approval);

    expect(events[0].eventId).toBe(
      'client_area.approval.cancelled:approval-1:2026-01-03T10:00:00.000Z',
    );
  });

  it('keys an agency_reply by the comment id so two replies both notify', async () => {
    const { service, events } = build();

    await service.publish('agency_reply', approval, {
      id: 'comment-1',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });
    await service.publish('agency_reply', approval, {
      id: 'comment-2',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    expect(events.map((event) => event.eventId)).toEqual([
      'client_area.approval.agency_reply:approval-1:comment-1',
      'client_area.approval.agency_reply:approval-1:comment-2',
    ]);
  });

  /**
   * AP4 §25/§31 — neither the operator's name nor the comment text travels in
   * any transport. The notification says something was said.
   */
  it('exposes neither operator identity nor comment body', async () => {
    const { service, events } = build();

    await service.publish('agency_reply', approval, {
      id: 'comment-1',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('comment body');
    expect(events[0].actorUserId).toBeUndefined();
    expect(events[0].clientAudience?.title).toBe('A agência respondeu');
  });

  it('never notifies about an approval the client was never sent', async () => {
    const { service, process } = build();

    await service.publish('cancelled', {
      ...approval,
      sentToClientAt: null,
    } as SocialApprovalRequestEntity);

    expect(process).not.toHaveBeenCalled();
  });

  /**
   * §3 — `awaiting_client` and `superseded` now ride the Agency publication as
   * a second audience of one notification. Publishing them here as well would
   * create a second notification for the same fact under a *different*
   * `source_event_id`, which the unique index could not catch.
   */
  it.each(['awaiting_client', 'superseded'] as const)(
    'does not double-publish %s, which the Agency path already addresses',
    async (type) => {
      const { service, process } = build();

      await service.publish(type, approval);

      expect(process).not.toHaveBeenCalled();
    },
  );

  it('swallows a publication failure rather than failing the transition', async () => {
    const { service, process } = build();
    process.mockRejectedValue(new Error('db down'));

    await expect(
      service.publish('cancelled', approval),
    ).resolves.toBeUndefined();
  });
});
