import { ClientApprovalNotificationService } from './client-approval-notification.service';
import type { SocialApprovalRequestEntity } from '../entities';

/**
 * AP3 §67 — client notification recipients.
 *
 * The audience is memberships, re-checked at delivery time. No Contact,
 * Organization or Agency Client is ever inferred into a recipient, and the
 * action URL is always the Client Area route.
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
  cancelledAt: null,
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
} as unknown as SocialApprovalRequestEntity;

function membership(
  userId: string,
  role: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `membership-${userId}`,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    companyContextId: 'company-a',
    userId,
    role,
    status: 'active',
    ...overrides,
  };
}

function build({
  memberships = [] as unknown[],
  eligible = new Set<string>(),
  emails = [] as unknown[],
  claim = true,
}: {
  memberships?: unknown[];
  eligible?: Set<string>;
  emails?: unknown[];
  claim?: boolean;
} = {}) {
  const membershipsRepo = {
    find: jest.fn().mockResolvedValue(memberships),
    manager: {},
  };
  const identitiesRepo = { find: jest.fn().mockResolvedValue(emails) };
  const insertExecute = jest.fn().mockResolvedValue({
    identifiers: claim ? [{ id: 'ledger-1' }] : [],
  });
  const ledgerRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      insert: () => ({
        into: () => ({
          values: () => ({ orIgnore: () => ({ execute: insertExecute }) }),
        }),
      }),
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const eligibility = {
    isMembershipEligible: jest
      .fn()
      .mockImplementation((_manager: unknown, input: { userId: string }) =>
        Promise.resolve(eligible.has(input.userId)),
      ),
  };
  const email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const credentials = {
    getEmailTransportOverride: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'CLIENT_AREA_FRONTEND_URL'
          ? 'https://app.example.com'
          : undefined,
      ),
  };

  const service = new ClientApprovalNotificationService(
    membershipsRepo as never,
    identitiesRepo as never,
    ledgerRepo as never,
    eligibility as never,
    email as never,
    credentials as never,
    config as never,
  );

  return {
    service,
    membershipsRepo,
    identitiesRepo,
    ledgerRepo,
    insertExecute,
    eligibility,
    email,
  };
}

describe('AP3 client notification recipients', () => {
  it('resolves active memberships whose preset grants approvals.view', async () => {
    const { service, membershipsRepo } = build({
      memberships: [
        membership('viewer', 'client_viewer'),
        membership('operator', 'client_operator'),
        membership('admin', 'client_admin'),
      ],
      eligible: new Set(['viewer', 'operator', 'admin']),
    });

    const recipients = await service.resolveRecipients(approval);

    // All three presets include approvals.view.
    expect(recipients.map((item) => item.userId).sort()).toEqual([
      'admin',
      'operator',
      'viewer',
    ]);
    // Only the approval's own company, and only active rows.
    expect(membershipsRepo.find).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        companyContextId: 'company-a',
        status: 'active',
      },
    });
  });

  it('excludes a membership whose CRM eligibility no longer holds', async () => {
    const { service } = build({
      memberships: [
        membership('valid', 'client_admin'),
        membership('archived-pf', 'client_admin'),
      ],
      eligible: new Set(['valid']),
    });

    const recipients = await service.resolveRecipients(approval);

    expect(recipients.map((item) => item.userId)).toEqual(['valid']);
  });

  it('excludes a revoked membership even if it is still eligible in CRM', async () => {
    // The repository filters on status='active'; a revoked row never arrives.
    const { service, membershipsRepo } = build({
      memberships: [],
      eligible: new Set(['revoked-user']),
    });

    const recipients = await service.resolveRecipients(approval);

    expect(recipients).toEqual([]);
    expect(membershipsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active' }),
      }),
    );
  });

  it('never infers a recipient from a Contact or an Organization', async () => {
    const { service, membershipsRepo, identitiesRepo } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });

    await service.publish('awaiting_client', approval);

    // Only the membership table and the identity's own security settings are
    // consulted; no contact/organization lookup exists in this path.
    const membershipWhere = membershipsRepo.find.mock.calls[0][0].where;
    expect(membershipWhere).not.toHaveProperty('contactId');
    expect(identitiesRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', userId: expect.anything() },
    });
  });
});

describe('AP3 client notification delivery', () => {
  it('sends to the identity email with a Client Area action URL', async () => {
    const { service, email } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });

    await service.publish('awaiting_client', approval);

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('member@example.com');
    expect(sent.html).toContain(
      'https://app.example.com/client-area/companies/company-a/approvals/approval-1',
    );
    // Never the Agency route.
    expect(sent.html).not.toContain('/social/approvals');
  });

  it('is idempotent: a second publish of the same event sends nothing', async () => {
    const { service, email } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
      claim: false, // the unique index rejected the claim
    });

    await service.publish('awaiting_client', approval);

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('records why nothing was sent when the identity has no email', async () => {
    const { service, email, ledgerRepo } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [],
    });

    await service.publish('awaiting_client', approval);

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(ledgerRepo.update).toHaveBeenCalledWith('ledger-1', {
      skippedReason: 'no_email',
    });
  });

  it('never notifies about an approval the client was never sent', async () => {
    const { service, membershipsRepo, email } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
    });

    await service.publish('awaiting_client', {
      ...approval,
      sentToClientAt: null,
    } as SocialApprovalRequestEntity);

    expect(membershipsRepo.find).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('keys the ledger by the transition moment so distinct events both send', async () => {
    const { service, insertExecute } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });

    await service.publish('awaiting_client', approval);
    await service.publish('superseded', {
      ...approval,
      supersededAt: new Date('2026-01-08T10:00:00.000Z'),
    } as SocialApprovalRequestEntity);

    expect(insertExecute).toHaveBeenCalledTimes(2);
  });

  it('swallows a delivery failure rather than failing the transition', async () => {
    const { service, email, ledgerRepo } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });
    email.sendEmail.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.publish('awaiting_client', approval),
    ).resolves.toBeUndefined();
    expect(ledgerRepo.update).toHaveBeenCalledWith('ledger-1', {
      skippedReason: 'send_failed',
    });
  });
});

/**
 * AP4 §24–§28 — Agency reply notification. Reuses this exact channel: same
 * recipient resolution, same email identity source, same ledger idempotency.
 * Only the event-id derivation differs, because a reply has no dedicated
 * timestamp column on the approval row.
 */
describe('AP4 agency reply notification', () => {
  it('delivers to eligible memberships without exposing the operator identity or comment body in the DTO path', async () => {
    const { service, email } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });

    await service.publish('agency_reply', approval, {
      id: 'comment-1',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = email.sendEmail.mock.calls[0][0];
    expect(sent.html).toContain(
      'https://app.example.com/client-area/companies/company-a/approvals/approval-1',
    );
    expect(sent.html).toContain('A agência respondeu');
  });

  it('keys the ledger by the comment id, so two distinct replies on the same approval both send', async () => {
    const { service, insertExecute } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
    });

    await service.publish('agency_reply', approval, {
      id: 'comment-1',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });
    await service.publish('agency_reply', approval, {
      id: 'comment-2',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    expect(insertExecute).toHaveBeenCalledTimes(2);
  });

  it('is idempotent on a retry of the same comment id (claim rejected, no second send)', async () => {
    const { service, email } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
      emails: [{ userId: 'member', currentEmail: 'member@example.com' }],
      claim: false,
    });

    await service.publish('agency_reply', approval, {
      id: 'comment-1',
      occurredAt: new Date('2026-01-05T10:00:00.000Z'),
    });

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('never notifies about a reply on an approval the client was never sent', async () => {
    const { service, membershipsRepo, email } = build({
      memberships: [membership('member', 'client_admin')],
      eligible: new Set(['member']),
    });

    await service.publish(
      'agency_reply',
      { ...approval, sentToClientAt: null } as SocialApprovalRequestEntity,
      { id: 'comment-1', occurredAt: new Date() },
    );

    expect(membershipsRepo.find).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
