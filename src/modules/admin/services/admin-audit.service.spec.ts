import type { Repository } from 'typeorm';
import { PlatformAdminAuditEventEntity } from '../entities';
import {
  AdminAuditService,
  sanitizeAdminAuditMetadata,
} from './admin-audit.service';

describe('AdminAuditService', () => {
  it('recursively removes passwords, hashes, tokens, 2FA codes and secrets', () => {
    const sanitized = sanitizeAdminAuditMetadata({
      reason: 'manual review',
      password: 'plain-text',
      nested: {
        passwordHash: '$argon2id$secret',
        accessToken: 'token-value',
        twoFactorCode: '123456',
        twoFactorEnabled: true,
        safe: 'kept',
      },
      authorizationHeader: 'Bearer credential',
      values: ['visible', 'Bearer abc.def.ghi'],
    });

    expect(sanitized).toEqual({
      reason: 'manual review',
      password: '[REDACTED]',
      nested: {
        passwordHash: '[REDACTED]',
        accessToken: '[REDACTED]',
        twoFactorCode: '[REDACTED]',
        twoFactorEnabled: true,
        safe: 'kept',
      },
      authorizationHeader: '[REDACTED]',
      values: ['visible', '[REDACTED]'],
    });
  });

  it('sanitizes metadata before persistence', async () => {
    const create = jest.fn(
      (
        value: Partial<PlatformAdminAuditEventEntity>,
      ): PlatformAdminAuditEventEntity =>
        value as PlatformAdminAuditEventEntity,
    );
    const save = jest.fn(
      (
        value: PlatformAdminAuditEventEntity,
      ): Promise<PlatformAdminAuditEventEntity> => Promise.resolve(value),
    );
    const repository = {
      create,
      save,
    };
    const service = new AdminAuditService(
      repository as unknown as Repository<PlatformAdminAuditEventEntity>,
    );

    await service.record({
      action: 'admin.test',
      outcome: 'denied',
      metadata: { refreshToken: 'must-not-persist', safe: true },
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { refreshToken: '[REDACTED]', safe: true },
      }),
    );
  });
});
