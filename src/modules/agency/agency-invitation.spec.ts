import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { AgencyAuthService } from './agency-auth.service';
import {
  AgencyPasswordResetEntity,
  AgencyUserSecuritySettingsEntity,
} from './entities/agency-auth.entities';
import {
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from './entities/agency-settings.entities';

jest.mock('otplib', () => ({}));

function fixture() {
  const manager = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    existsBy: jest.fn().mockResolvedValue(false),
    create: jest.fn((_entity, row) => row),
    save: jest.fn((row) => ({ ...row, id: 'workspace-user' })),
    insert: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const transaction = async (work: (manager: unknown) => unknown) =>
    work(manager);
  const sendEmail = jest.fn();
  const resetRepo = { manager: { transaction }, findOne: jest.fn() };
  const service = new AgencyAuthService(
    {} as never,
    { manager: { transaction } } as never,
    {} as never,
    {} as never,
    resetRepo as never,
    {} as never,
    {} as never,
    new ConfigService({
      AGENCY_FRONTEND_URL: 'https://agency.example.com',
      EMAIL_DELIVERY_MODE: 'smtp',
    }),
    { sendEmail } as never,
    {
      hashToken: (token: string) =>
        createHash('sha256').update(token).digest('hex'),
      getEmailTransportOverride: jest.fn(),
    } as never,
    { consume: jest.fn() } as never,
  );
  return { service, manager, sendEmail, resetRepo };
}

describe('Agency workspace invitations', () => {
  const email = 'reviewer@example.com';
  const request = { headers: {}, socket: {} } as Request;

  it('emails an Agency link backed by a hashed token and blocks products on a new Member invite', async () => {
    const { service, manager, sendEmail } = fixture();
    await service.sendWorkspaceInvitation('tenant', 'workspace', {
      email,
      role: 'member',
    });
    const message = sendEmail.mock.calls[0][0];
    const link = message.html.match(
      /https:\/\/agency\.example\.com\/reset-password\?token=([a-f0-9]{64})/,
    );
    expect(message.to).toBe(email);
    expect(link).not.toBeNull();
    expect(manager.insert).toHaveBeenCalledWith(
      AgencyPasswordResetEntity,
      expect.objectContaining({
        surface: 'agency',
        tokenHash: createHash('sha256').update(link![1]).digest('hex'),
      }),
    );
    expect(manager.insert).toHaveBeenCalledWith(
      AgencyWorkspaceUserPermissionEntity,
      ['agency', 'leadflow', 'social'].map((appKey) =>
        expect.objectContaining({
          appKey,
          access: 'blocked',
        }),
      ),
    );
  });

  it('reuses a pending invitation and reports an SMTP failure', async () => {
    const { service, manager, sendEmail } = fixture();
    manager.findOne.mockResolvedValue({
      id: 'workspace-user',
      userId: 'reviewer',
      status: 'invited',
    });
    sendEmail.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(
      service.sendWorkspaceInvitation('tenant', 'workspace', {
        email,
        role: 'member',
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      AgencyPasswordResetEntity,
      expect.objectContaining({ userId: 'reviewer', surface: 'agency' }),
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
  });

  it('activates the invited account only after the token is consumed', async () => {
    const { service, manager, resetRepo } = fixture();
    manager.findOne.mockResolvedValue({ id: 'workspace-user', email });
    resetRepo.findOne.mockResolvedValue({
      id: 'reset',
      tenantId: 'tenant',
      userId: 'reviewer',
      expiresAt: new Date(Date.now() + 60_000),
    });
    manager.update.mockResolvedValueOnce({ affected: 0 });
    await expect(
      service.resetPassword('token', 'long-password', request),
    ).rejects.toMatchObject({ status: 401 });
    expect(manager.insert).not.toHaveBeenCalled();

    await expect(
      service.resetPassword('token', 'long-password', request),
    ).resolves.toEqual({ success: true });
    expect(manager.insert).toHaveBeenCalledWith(
      AgencyUserSecuritySettingsEntity,
      expect.objectContaining({ currentEmail: email, userId: 'reviewer' }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      AgencyWorkspaceUserEntity,
      'workspace-user',
      expect.objectContaining({ status: 'active' }),
    );
  });
});
