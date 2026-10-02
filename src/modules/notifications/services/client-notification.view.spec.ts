import {
  companyContextIdOf,
  toClientNotificationItem,
} from './client-notification.view';
import { mapNotificationRecipientToListItem } from './notification-list-item.mapper';
import {
  NotificationActionType,
  NotificationActorType,
  NotificationCategory,
  NotificationInterestReason,
  NotificationPriority,
  NotificationProductKey,
  NotificationRecipientSurface,
} from '../enums';
import type { NotificationRecipientEntity } from '../entities';

/**
 * NTF-C1 §43 — the client projection exposes what the client needs and
 * nothing else.
 *
 * The decisive test is not "does it carry the right fields" but "can an
 * internal field reach the client". So the suite asserts against the *Agency*
 * item's key set: anything the Agency mapper exposes that is internal must be
 * absent here, which is a check that keeps working when someone adds a field
 * to the notification entity.
 */

function makeRecipient(
  overrides: { metadata?: Record<string, unknown> } = {},
): NotificationRecipientEntity {
  return {
    id: 'recipient-1',
    notificationId: 'notification-1',
    userId: 'user-1',
    recipientSurface: NotificationRecipientSurface.CLIENT_AREA,
    interestReason: NotificationInterestReason.APPROVER,
    seenAt: null,
    readAt: null,
    archivedAt: null,
    dismissedAt: null,
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
    deliveries: [],
    notification: {
      id: 'notification-1',
      tenantId: 'tenant-secret',
      workspaceId: 'workspace-secret',
      managedTenantId: 'managed-secret',
      productKey: NotificationProductKey.SOCIAL,
      moduleKey: 'approvals',
      eventType: 'social.approval.awaiting_client',
      category: NotificationCategory.APPROVAL,
      priority: NotificationPriority.NORMAL,
      title: 'Aprovação aguardando cliente',
      body: 'Corpo interno',
      actionType: NotificationActionType.INTERNAL_ROUTE,
      actionUrl: '/social/approvals?approvalId=approval-1',
      resourceType: 'social_approval_request',
      resourceId: 'approval-1',
      actorType: NotificationActorType.USER,
      actorUserId: 'agency-operator-secret',
      initiatedByUserId: 'agency-operator-secret',
      sourceEventId: 'social.approval.awaiting_client:approval-1:2026',
      deduplicationKey: null,
      templateKey: 'notifications.social.approval.awaiting_client',
      templateVariables: { internalOnly: 'secret' },
      metadata: overrides.metadata ?? {
        companyContextId: 'company-a',
        clientActionUrl: '/client-area/companies/company-a/approvals/approval-1',
        clientTitle: 'Uma aprovação aguarda você',
        clientBody: 'Post de lançamento (r2) foi enviado para a sua aprovação.',
        internalNote: 'never-expose-me',
      },
      occurredAt: new Date('2026-02-01T09:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-02-01T10:00:00.000Z'),
    },
  } as unknown as NotificationRecipientEntity;
}

describe('client notification projection', () => {
  it('exposes the client fields', () => {
    const item = toClientNotificationItem(makeRecipient(), 'company-a');

    expect(item).toEqual({
      id: 'notification-1',
      recipientId: 'recipient-1',
      title: 'Uma aprovação aguarda você',
      body: 'Post de lançamento (r2) foi enviado para a sua aprovação.',
      category: NotificationCategory.APPROVAL,
      priority: NotificationPriority.NORMAL,
      actionType: NotificationActionType.INTERNAL_ROUTE,
      actionUrl: '/client-area/companies/company-a/approvals/approval-1',
      companyContextId: 'company-a',
      occurredAt: '2026-02-01T09:00:00.000Z',
      createdAt: '2026-02-01T10:00:00.000Z',
      seenAt: null,
      readAt: null,
      isSeen: false,
      isRead: false,
    });
  });

  it('leaks no internal identifier, actor or metadata', () => {
    const serialized = JSON.stringify(
      toClientNotificationItem(makeRecipient(), 'company-a'),
    );

    for (const secret of [
      'tenant-secret',
      'workspace-secret',
      'managed-secret',
      'agency-operator-secret',
      'never-expose-me',
      'internalOnly',
      'social.approval.awaiting_client:approval-1:2026',
      'Corpo interno',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  /**
   * The structural check: every internal key the Agency item carries is
   * absent from the client one. Adding a field to the Agency mapper will not
   * silently extend the client surface.
   */
  it('shares no internal key with the Agency list item', () => {
    const recipient = makeRecipient();
    const agencyItem = mapNotificationRecipientToListItem(recipient);
    const clientItem = toClientNotificationItem(recipient, 'company-a');

    for (const internalKey of [
      'eventType',
      'productKey',
      'moduleKey',
      'resourceType',
      'resourceId',
      'actorType',
      'actorUserId',
      'interestReason',
    ]) {
      expect(agencyItem).toHaveProperty(internalKey);
      expect(clientItem).not.toHaveProperty(internalKey);
    }
  });

  /** §16 — an Agency route must never be handed to a client. */
  it('refuses an action URL that is not a Client Area route', () => {
    const item = toClientNotificationItem(
      makeRecipient({
        metadata: {
          companyContextId: 'company-a',
          clientActionUrl: '/social/approvals?approvalId=approval-1',
        },
      }),
      'company-a',
    );

    expect(item.actionUrl).toBeNull();
    // No usable route means no button, rather than a button that goes nowhere.
    expect(item.actionType).toBe(NotificationActionType.NONE);
  });

  it('refuses an absolute action URL', () => {
    const item = toClientNotificationItem(
      makeRecipient({
        metadata: {
          companyContextId: 'company-a',
          clientActionUrl: 'https://evil.example.com/client-area/x',
        },
      }),
      'company-a',
    );

    expect(item.actionUrl).toBeNull();
  });

  it('falls back to the shared title when no client copy was written', () => {
    const item = toClientNotificationItem(
      makeRecipient({ metadata: { companyContextId: 'company-a' } }),
      'company-a',
    );

    expect(item.title).toBe('Aprovação aguardando cliente');
  });

  describe('companyContextIdOf', () => {
    it('reads the company the publisher recorded', () => {
      expect(
        companyContextIdOf({ metadata: { companyContextId: 'company-a' } }),
      ).toBe('company-a');
    });

    it('never guesses a company', () => {
      expect(companyContextIdOf({ metadata: {} })).toBeNull();
      expect(companyContextIdOf({ metadata: null })).toBeNull();
      expect(companyContextIdOf({ metadata: { companyContextId: 42 } })).toBeNull();
      expect(companyContextIdOf({ metadata: { companyContextId: '  ' } })).toBeNull();
    });
  });
});
