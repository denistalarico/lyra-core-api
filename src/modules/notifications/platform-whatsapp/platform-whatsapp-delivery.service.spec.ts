import type { Repository } from 'typeorm';
import type { PlatformWhatsAppNotificationDeliveryEntity } from './platform-whatsapp-notification-delivery.entity';
import {
  PlatformWhatsAppDeliveryService,
  type PlatformWhatsAppDeliveryRequest,
} from './platform-whatsapp-delivery.service';
import type { PlatformWhatsAppNotificationSender } from './platform-whatsapp-notification.sender';

function request(
  overrides: Partial<PlatformWhatsAppDeliveryRequest> = {},
): PlatformWhatsAppDeliveryRequest {
  return {
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
      handoffReason: 'Pediu humano',
    },
    ...overrides,
  };
}

function build(options: {
  sendTemplate?: jest.Mock;
  findOne?: jest.Mock;
  save?: jest.Mock;
}) {
  const sendTemplate =
    options.sendTemplate ??
    jest
      .fn()
      .mockResolvedValue({ status: 'sent', providerMessageId: 'wamid.1' });
  const sender = {
    sendTemplate,
  } as unknown as PlatformWhatsAppNotificationSender;

  const findOne = options.findOne ?? jest.fn().mockResolvedValue(null);
  const save = options.save ?? jest.fn().mockResolvedValue(undefined);
  const deliveries = {
    findOne,
    save,
    create: (data: unknown) => ({ ...(data as object) }),
  } as unknown as Repository<PlatformWhatsAppNotificationDeliveryEntity>;

  const service = new PlatformWhatsAppDeliveryService(sender, deliveries);
  return { service, sendTemplate, findOne, save };
}

describe('PlatformWhatsAppDeliveryService', () => {
  it('never resends once a row for the key is already sent', async () => {
    const findOne = jest.fn().mockResolvedValue({
      status: 'sent',
      providerMessageId: 'wamid.prev',
    });
    const { service, sendTemplate, save } = build({ findOne });

    const result = await service.deliverOnce(request());

    expect(result).toEqual({
      status: 'already_sent',
      providerMessageId: 'wamid.prev',
    });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('sends and records a sent delivery when there is no prior success', async () => {
    const { service, save } = build({});

    const result = await service.deliverOnce(request());

    expect(result).toEqual({ status: 'sent', providerMessageId: 'wamid.1' });
    const saved = save.mock.calls[0][0] as {
      status: string;
      providerMessageId: string | null;
      attempts: number;
      idempotencyKey: string;
    };
    expect(saved.status).toBe('sent');
    expect(saved.providerMessageId).toBe('wamid.1');
    expect(saved.attempts).toBe(1);
    expect(saved.idempotencyKey).toContain('conv-1');
  });

  it('records a failed delivery with the sanitized provider detail', async () => {
    const sendTemplate = jest.fn().mockResolvedValue({
      status: 'failed',
      providerCode: '131047',
      message: 'Re-engagement message',
    });
    const { service, save } = build({ sendTemplate });

    const result = await service.deliverOnce(request());

    expect(result).toEqual({ status: 'failed', providerCode: '131047' });
    const saved = save.mock.calls[0][0] as {
      status: string;
      providerCode: string | null;
      sanitizedMessage: string | null;
      providerMessageId: string | null;
    };
    expect(saved.status).toBe('failed');
    expect(saved.providerCode).toBe('131047');
    expect(saved.sanitizedMessage).toBe('Re-engagement message');
    expect(saved.providerMessageId).toBeNull();
  });

  it('does not persist a skip (a skip is not a delivery)', async () => {
    const sendTemplate = jest
      .fn()
      .mockResolvedValue({ status: 'skipped', reasonCode: 'provider_disabled' });
    const { service, save } = build({ sendTemplate });

    const result = await service.deliverOnce(request());

    expect(result).toEqual({ status: 'skipped', reasonCode: 'provider_disabled' });
    expect(save).not.toHaveBeenCalled();
  });
});
