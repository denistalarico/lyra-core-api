import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PatchInboxChannelDto } from './patch-inbox-channel.dto';

describe('PatchInboxChannelDto', () => {
  it('accepts only safe operational fields', async () => {
    const dto = plainToInstance(PatchInboxChannelDto, {
      name: 'WhatsApp Vendas',
      aiEnabled: false,
      debounceSeconds: 20,
    });
    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    'tenantId',
    'workspaceId',
    'id',
    'type',
    'status',
    'provider',
    'externalPhoneNumberId',
    'externalAccountId',
    'appId',
    'accessToken',
    'credential',
    'verifyToken',
    'webhookSecret',
    'defaultAgentId',
    'metadata',
    'settings',
  ])('rejects protected or unknown field %s', async (field) => {
    const dto = plainToInstance(PatchInboxChannelDto, {
      name: 'Canal seguro',
      [field]: 'forbidden',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
