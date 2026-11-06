import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { NotificationInterestReason } from '../../notifications/enums';
import { TeamMember } from '../../team/entities';
import { TeamMemberStatus } from '../../team/enums';
import { ContractRecord } from '../entities';
import {
  ContractDocumentKind,
  ContractStatus,
  ContractTargetType,
} from '../enums';
import { ContractNotificationPublisher } from './contract-notification.publisher';

@Injectable()
export class TeamContractLifecycleNotificationsService {
  constructor(
    @InjectRepository(ContractRecord, 'agency')
    private readonly contracts: Repository<ContractRecord>,
    @InjectRepository(TeamMember, 'agency')
    private readonly members: Repository<TeamMember>,
    @InjectRepository(WorkspaceUserEntity, 'agency')
    private readonly workspaceUsers: Repository<WorkspaceUserEntity>,
    private readonly permissions: PlatformPermissionService,
    private readonly publisher: ContractNotificationPublisher,
  ) {}

  @Cron('0 */6 * * *')
  async publishDueNotifications(now = new Date()): Promise<void> {
    const contracts = await this.contracts.find({
      where: {
        targetType: ContractTargetType.TeamMember,
        documentKind: ContractDocumentKind.Contract,
      },
      order: { targetId: 'ASC', validFrom: 'DESC', createdAt: 'DESC' },
    });
    const byMember = new Map<string, ContractRecord[]>();
    for (const contract of contracts) {
      if (!contract.targetId || contract.archivedAt || contract.cancelledAt)
        continue;
      if (
        [ContractStatus.Archived, ContractStatus.Cancelled].includes(
          contract.status,
        )
      )
        continue;
      const rows = byMember.get(contract.targetId) ?? [];
      rows.push(contract);
      byMember.set(contract.targetId, rows);
    }

    const today = now.toISOString().slice(0, 10);
    const warning = new Date(now);
    warning.setUTCDate(warning.getUTCDate() + 30);
    const warningDate = warning.toISOString().slice(0, 10);

    for (const [memberId, rows] of byMember) {
      const contract = rows[0];
      const member = await this.members.findOneBy({
        id: memberId,
        tenantId: contract.tenantId,
        workspaceId: contract.workspaceId,
      });
      if (
        !member ||
        member.archivedAt ||
        member.status !== TeamMemberStatus.Active
      )
        continue;
      const recipients = await this.resolveRecipients(contract);
      if (recipients.length === 0) continue;

      if (
        contract.validUntil &&
        (contract.status === ContractStatus.Expired ||
          contract.validUntil < today)
      ) {
        await this.publisher.publishExpired({ contract, recipients });
        continue;
      }
      if (contract.validUntil && contract.validUntil <= warningDate) {
        await this.publisher.publishExpiring({ contract, recipients });
      }

      const previous = rows
        .slice(1)
        .find(
          (row) =>
            row.status === ContractStatus.Expired ||
            Boolean(row.validUntil && row.validUntil < today),
        );
      if (previous && (!contract.validUntil || contract.validUntil >= today)) {
        await this.publisher.publishRenewed({
          contract,
          previousContractId: previous.id,
          recipients,
        });
      }
    }
  }

  private async resolveRecipients(contract: ContractRecord) {
    const users = await this.workspaceUsers.find({
      where: {
        tenantId: contract.tenantId,
        workspaceId: contract.workspaceId,
        status: 'active',
      },
    });
    const allowed = await Promise.all(
      users.map(async (user) => ({
        userId: user.userId,
        allowed:
          Boolean(user.userId) &&
          (await this.permissions.can(
            {
              tenantId: contract.tenantId,
              workspaceId: contract.workspaceId,
              userId: user.userId!,
              role: user.role,
            },
            'agency.team.directory.view.all_members',
          )),
      })),
    );
    return allowed
      .filter((entry) => entry.allowed && entry.userId)
      .map((entry) => ({
        userId: entry.userId,
        interestReason: NotificationInterestReason.RESPONSIBLE_ROLE,
      }));
  }
}
