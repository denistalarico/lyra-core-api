import { BadRequestException } from '@nestjs/common';
import { ClientNotificationsService } from './client-notifications.service';

function build(preferences: Array<Record<string, unknown>> = []) {
  const recipientRepo = {};
  const row = {
    id: 'preference-id',
    tenantId: 'tenant-a',
    userId: 'user-a',
    preferences,
  };
  const preferencesRepo = {
    findOne: jest.fn().mockResolvedValue(row),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  return {
    service: new ClientNotificationsService(
      recipientRepo as never,
      preferencesRepo as never,
    ),
    preferencesRepo,
    row,
  };
}

describe('R3 client notification preferences', () => {
  const reader = { tenantId: 'tenant-a', userId: 'user-a' };

  it('reads per-type email preferences from the canonical preference row', async () => {
    const { service } = build([
      { key: 'invoice.due_soon', channels: { email: false } },
    ]);

    const result = await service.preferences(reader);

    expect(
      result.items.find((item) => item.type === 'invoice.due_soon'),
    ).toEqual({ type: 'invoice.due_soon', email: false });
    expect(
      result.items.find((item) => item.type === 'conversation.message'),
    ).toEqual({ type: 'conversation.message', email: true });
  });

  it('updates only the catalog entry and keeps in-app required and WhatsApp off', async () => {
    const { service, preferencesRepo, row } = build([
      { key: 'unrelated-agency-setting', channels: { email: true } },
    ]);

    await service.updatePreference(reader, {
      type: 'invoice.overdue',
      email: false,
    });

    expect(row.preferences).toContainEqual({
      key: 'unrelated-agency-setting',
      channels: { email: true },
    });
    expect(row.preferences).toContainEqual({
      key: 'invoice.overdue',
      channels: {
        app: true,
        push: true,
        email: false,
        whatsapp: false,
      },
    });
    expect(preferencesRepo.save).toHaveBeenCalledWith(row);
  });

  it('rejects unknown types as a stable client input error', async () => {
    const { service } = build();
    await expect(
      service.updatePreference(reader, { type: 'unknown', email: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
