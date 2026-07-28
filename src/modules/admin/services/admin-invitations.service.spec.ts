import { ConflictException, GoneException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import type { EmailService } from '../../email/email.service';
import type { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import type {
  PlatformAdminInvitationEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type { AdminAuditService } from './admin-audit.service';
import { AdminInvitationTokenService } from './admin-invitation-token.service';
import { AdminInvitationsService } from './admin-invitations.service';
import type { AdminRolePolicyService } from './admin-role-policy.service';

const pendingInvitation = (
  tokenService: AdminInvitationTokenService,
): PlatformAdminInvitationEntity =>
  ({
    id: '2f295a77-bddb-4d39-b472-fcf777405681',
    email: 'person@example.com',
    normalizedEmail: 'person@example.com',
    roleKey: 'support_admin',
    status: 'pending',
    tokenHash: tokenService.hash('opaque-invitation-token'),
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    cancelledAt: null,
    invitedByAdminId: 'fc623572-6c47-413a-a4c2-df4c820b7fee',
    acceptedByUserId: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as PlatformAdminInvitationEntity;

describe('AdminInvitationsService', () => {
  const tokenService = new AdminInvitationTokenService();

  function setup(invitation = pendingInvitation(tokenService)) {
    const invitationRepository = {
      findOne: jest.fn().mockResolvedValue(invitation),
      save: jest.fn(async (record) => record),
    };
    const adminRepository = { findOne: jest.fn() };
    const gateway = {
      findCandidatesByEmail: jest.fn().mockResolvedValue([
        {
          tenantId: 'tenant',
          userId: 'user',
          email: invitation.email,
          displayName: 'Person',
          status: 'active',
          passwordConfigured: true,
          twoFactorEnabled: true,
          twoFactorMethod: 'authenticator',
        },
      ]),
    };
    const dataSource = { transaction: jest.fn() };
    const service = new AdminInvitationsService(
      invitationRepository as unknown as Repository<PlatformAdminInvitationEntity>,
      adminRepository as unknown as Repository<PlatformInternalAdminEntity>,
      dataSource as unknown as DataSource,
      gateway as unknown as AdminIdentityGateway,
      {} as AdminRolePolicyService,
      tokenService,
      {} as AdminAuditService,
      {} as EmailService,
      { get: jest.fn() } as unknown as ConfigService,
    );
    return { service, invitationRepository, gateway, dataSource };
  }

  it('validates with a minimal safe response and never returns token material', async () => {
    const { service } = setup();

    const response = await service.validate('opaque-invitation-token');

    expect(response).toEqual({
      valid: true,
      emailMasked: 'pe****@example.com',
      roleKey: 'support_admin',
      expiresAt: expect.any(Date),
      identityExists: true,
    });
    expect(response).not.toHaveProperty('token');
    expect(response).not.toHaveProperty('tokenHash');
  });

  it('persists expiration when an expired invitation is consulted', async () => {
    const invitation = pendingInvitation(tokenService);
    invitation.expiresAt = new Date(Date.now() - 1);
    const { service, invitationRepository } = setup(invitation);

    await expect(
      service.validate('opaque-invitation-token'),
    ).rejects.toBeInstanceOf(GoneException);
    expect(invitation.status).toBe('expired');
    expect(invitationRepository.save).toHaveBeenCalledWith(invitation);
  });

  it('returns the explicit A4.7 provisioning state without creating credentials', async () => {
    const invitation = pendingInvitation(tokenService);
    const { service, gateway, dataSource } = setup(invitation);
    gateway.findCandidatesByEmail.mockResolvedValue([]);
    dataSource.transaction.mockImplementation(
      async (callback: (manager: { findOne: jest.Mock }) => Promise<unknown>) =>
        callback({
          findOne: jest.fn().mockResolvedValue(invitation),
        }),
    );

    try {
      await service.accept('opaque-invitation-token', {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        acceptLanguage: 'pt-BR',
        deviceFingerprint: 'fingerprint',
        deviceName: 'test',
        location: null,
      });
      throw new Error('Expected provisioning conflict.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ADMIN_IDENTITY_PROVISIONING_REQUIRED',
        identityExists: false,
      });
    }
  });
});
