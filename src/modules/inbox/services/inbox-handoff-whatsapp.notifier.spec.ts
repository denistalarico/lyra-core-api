import type { DataSource } from 'typeorm';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
} from '../../agency/entities/agency-settings.entities';
import type { PlatformWhatsAppDeliveryService } from '../../notifications/platform-whatsapp/platform-whatsapp-delivery.service';
import type { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxHandoffWhatsAppNotifier } from './inbox-handoff-whatsapp.notifier';

function conversation(
  overrides: Partial<InboxConversationEntity> = {},
): InboxConversationEntity {
  return {
    id: 'conv-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    ownershipVersion: 3,
    title: 'João',
    externalThreadId: '+5511777776666',
    ownershipReason: 'palavra-chave sensível',
    ...overrides,
  } as InboxConversationEntity;
}

function build(options: {
  deliverOnce?: jest.Mock;
  profile?: unknown;
  company?: unknown;
}) {
  const deliverOnce =
    options.deliverOnce ??
    jest.fn().mockResolvedValue({ status: 'sent', providerMessageId: 'w1' });
  const delivery = {
    deliverOnce,
  } as unknown as PlatformWhatsAppDeliveryService;

  const profileFindOne = jest.fn().mockResolvedValue(
    'profile' in options ? options.profile : { id: 'p1', phone: '+5511999998888' },
  );
  const companyFindOne = jest.fn().mockResolvedValue(
    'company' in options
      ? options.company
      : { id: 'c1', workspaceName: 'Acme', tradeName: '', legalName: '' },
  );

  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === AgencyUserProfileEntity) {
        return { findOne: profileFindOne };
      }
      if (entity === AgencyWorkspaceCompanySettingsEntity) {
        return { findOne: companyFindOne };
      }
      throw new Error('unexpected repository');
    },
  } as unknown as DataSource;

  const notifier = new InboxHandoffWhatsAppNotifier(delivery, dataSource);
  return { notifier, deliverOnce, profileFindOne, companyFindOne };
}

describe('InboxHandoffWhatsAppNotifier', () => {
  it('resolves the named variables and phone, then delivers once per recipient', async () => {
    const { notifier, deliverOnce } = build({});

    await notifier.notifyHandoff({
      conversation: conversation(),
      recipientUserIds: ['user-1'],
    });

    expect(deliverOnce).toHaveBeenCalledTimes(1);
    expect(deliverOnce.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      subjectType: 'inbox_conversation',
      subjectId: 'conv-1',
      handoffCycleId: 3,
      recipientUserId: 'user-1',
      templateKey: 'leadflow.handoff.requested',
      toPhoneE164: '+5511999998888',
      variables: {
        workspaceName: 'Acme',
        contactDisplayName: 'João',
        handoffReason: 'palavra-chave sensível',
      },
    });
  });

  it('skips a recipient with no phone on file', async () => {
    const { notifier, deliverOnce } = build({ profile: { id: 'p1', phone: null } });

    await notifier.notifyHandoff({
      conversation: conversation(),
      recipientUserIds: ['user-1'],
    });

    expect(deliverOnce).not.toHaveBeenCalled();
  });

  it('falls back to a masked phone when the conversation has no title', async () => {
    const { notifier, deliverOnce } = build({});

    await notifier.notifyHandoff({
      conversation: conversation({ title: null }),
      recipientUserIds: ['user-1'],
    });

    expect(deliverOnce.mock.calls[0][0].variables.contactDisplayName).toBe(
      '••••6666',
    );
  });

  it('never throws when a delivery fails (isolated from the handoff)', async () => {
    const deliverOnce = jest.fn().mockRejectedValue(new Error('boom'));
    const { notifier } = build({ deliverOnce });

    await expect(
      notifier.notifyHandoff({
        conversation: conversation(),
        recipientUserIds: ['user-1'],
      }),
    ).resolves.toBeUndefined();
  });

  it('does nothing when there are no recipients', async () => {
    const { notifier, deliverOnce, companyFindOne } = build({});

    await notifier.notifyHandoff({
      conversation: conversation(),
      recipientUserIds: [],
    });

    expect(deliverOnce).not.toHaveBeenCalled();
    expect(companyFindOne).not.toHaveBeenCalled();
  });
});
