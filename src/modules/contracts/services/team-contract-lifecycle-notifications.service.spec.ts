import { Repository } from 'typeorm';
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { TeamMember } from '../../team/entities';
import { ContractRecord } from '../entities';
import {
  ContractDocumentKind,
  ContractStatus,
  ContractTargetType,
} from '../enums';
import { ContractNotificationPublisher } from './contract-notification.publisher';
import { TeamContractLifecycleNotificationsService } from './team-contract-lifecycle-notifications.service';

describe('TeamContractLifecycleNotificationsService', () => {
  it('notifies permitted Team users about expired and renewed member contracts', async () => {
    const base = {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      targetType: ContractTargetType.TeamMember,
      documentKind: ContractDocumentKind.Contract,
      archivedAt: null,
      cancelledAt: null,
    };
    const contracts = {
      find: jest.fn().mockResolvedValue([
        {
          ...base,
          id: 'renewed',
          targetId: 'member-1',
          title: 'Novo',
          status: ContractStatus.Draft,
          validFrom: '2026-11-01',
          validUntil: '2027-01-31',
        },
        {
          ...base,
          id: 'previous',
          targetId: 'member-1',
          title: 'Antigo',
          status: ContractStatus.Expired,
          validFrom: '2025-11-01',
          validUntil: '2026-10-31',
        },
        {
          ...base,
          id: 'expired',
          targetId: 'member-2',
          title: 'Vencido',
          status: ContractStatus.Expired,
          validFrom: '2025-11-01',
          validUntil: '2026-11-01',
        },
      ]),
    };
    const members = {
      findOneBy: jest.fn().mockImplementation(({ id }: { id: string }) =>
        Promise.resolve({
          id,
          displayName: id,
          status: 'active',
          archivedAt: null,
        }),
      ),
    };
    const workspaceUsers = {
      find: jest
        .fn()
        .mockResolvedValue([
          { userId: 'owner-1', role: 'owner', status: 'active' },
        ]),
    };
    const permissions = { can: jest.fn().mockResolvedValue(true) };
    const publisher = {
      publishExpired: jest.fn().mockResolvedValue(undefined),
      publishExpiring: jest.fn().mockResolvedValue(undefined),
      publishRenewed: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TeamContractLifecycleNotificationsService(
      contracts as unknown as Repository<ContractRecord>,
      members as unknown as Repository<TeamMember>,
      workspaceUsers as unknown as Repository<WorkspaceUserEntity>,
      permissions as unknown as PlatformPermissionService,
      publisher as unknown as ContractNotificationPublisher,
    );

    await service.publishDueNotifications(new Date('2026-11-06T12:00:00.000Z'));

    expect(publisher.publishRenewed).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: expect.objectContaining({ id: 'renewed' }),
        previousContractId: 'previous',
      }),
    );
    expect(publisher.publishExpired).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: expect.objectContaining({ id: 'expired' }),
      }),
    );
    expect(permissions.can).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1' }),
      'agency.team.directory.view.all_members',
    );
  });
});
