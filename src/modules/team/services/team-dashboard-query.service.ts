import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TeamAttendanceEntry,
  TeamDepartment,
  TeamMember,
  TeamMemberLifecycleProcess,
  TeamMemberPresence,
} from '../entities';
import { TeamLifecycleProcessStatus } from '../enums';
import type { TeamDashboardSummary } from '../types';

type TeamDashboardContext = {
  tenantId: string;
  workspaceId: string;
};

@Injectable()
export class TeamDashboardQueryService {
  constructor(
    @InjectRepository(TeamMember, 'agency')
    private readonly memberRepository: Repository<TeamMember>,

    @InjectRepository(TeamMemberPresence, 'agency')
    private readonly presenceRepository: Repository<TeamMemberPresence>,

    @InjectRepository(TeamAttendanceEntry, 'agency')
    private readonly attendanceRepository: Repository<TeamAttendanceEntry>,

    @InjectRepository(TeamDepartment, 'agency')
    private readonly departmentRepository: Repository<TeamDepartment>,

    @InjectRepository(TeamMemberLifecycleProcess, 'agency')
    private readonly lifecycleProcessRepository: Repository<TeamMemberLifecycleProcess>,
  ) {}

  async getSummary(
    context: TeamDashboardContext,
  ): Promise<TeamDashboardSummary> {
    const now = new Date();
    const todayStart = this.startOfUtcDay(now);
    const todayEnd = this.endOfUtcDay(now);

    const [
      members,
      presences,
      departments,
      attendanceToday,
      lifecycleProcesses,
    ] = await Promise.all([
        this.memberRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        }),

        this.presenceRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        }),

        this.departmentRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        }),

        this.attendanceRepository
          .createQueryBuilder('attendance')
          .where('attendance.tenant_id = :tenantId', {
            tenantId: context.tenantId,
          })
          .andWhere('attendance.workspace_id = :workspaceId', {
            workspaceId: context.workspaceId,
          })
          .andWhere('attendance.occurred_at >= :todayStart', {
            todayStart,
          })
          .andWhere('attendance.occurred_at <= :todayEnd', {
            todayEnd,
          })
          .getMany(),

        this.lifecycleProcessRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            status: TeamLifecycleProcessStatus.InProgress,
          },
          order: {
            startedAt: 'DESC',
            createdAt: 'DESC',
          },
        }),
      ]);

    const activeMembers = members.filter(
      (member) =>
        member.status === 'active' &&
        member.archivedAt === null,
    );

    const activeMemberIds = new Set(
      activeMembers.map((member) => member.id),
    );

    const presenceByMemberId = presences
      .filter((presence) =>
        activeMemberIds.has(presence.memberId),
      )
      .sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime(),
      )
      .reduce<Map<string, TeamMemberPresence>>(
        (result, presence) => {
          if (!result.has(presence.memberId)) {
            result.set(presence.memberId, presence);
          }

          return result;
        },
        new Map(),
      );

    const byPresenceStatus = Array.from(
      presenceByMemberId.values(),
    ).reduce<Record<string, number>>(
      (result, presence) => {
        result[presence.status] =
          (result[presence.status] ?? 0) + 1;
        return result;
      },
      {},
    );

    const distributionMap = members.reduce<
      Map<string | null, number>
    >((result, member) => {
      const key = member.departmentId ?? null;
      result.set(key, (result.get(key) ?? 0) + 1);
      return result;
    }, new Map());

    const attendanceMemberIds = new Set(
      attendanceToday.map((entry) => entry.memberId),
    );
    const memberById = new Map(
      members.map((member) => [member.id, member]),
    );

    return {
      generatedAt: now.toISOString(),

      members: {
        total: members.length,
        active: activeMembers.length,
        inactive: members.filter(
          (member) => member.status === 'inactive',
        ).length,
        archived: members.filter(
          (member) =>
            member.status === 'archived' ||
            member.archivedAt !== null,
        ).length,
        attendanceEnabled: activeMembers.filter(
          (member) => member.attendanceEnabled,
        ).length,
        linkedToUser: activeMembers.filter(
          (member) => member.userId !== null,
        ).length,
        withoutDepartment: activeMembers.filter(
          (member) => member.departmentId === null,
        ).length,
      },

      presence: {
        known: activeMembers.filter((member) =>
          presenceByMemberId.has(member.id),
        ).length,
        unknown: activeMembers.filter(
          (member) => !presenceByMemberId.has(member.id),
        ).length,
        byStatus: byPresenceStatus,
      },

      departments: {
        total: departments.length,
        distribution: Array.from(
          distributionMap.entries(),
        ).map(([departmentId, count]) => ({
          departmentId,
          count,
        })),
      },

      attendanceToday: {
        entries: attendanceToday.length,
        membersWithEntries: attendanceMemberIds.size,
      },

      lifecycleProcesses: lifecycleProcesses.flatMap((process) => {
        const member = memberById.get(process.memberId);

        if (!member || member.archivedAt !== null) {
          return [];
        }

        return [
          {
            id: process.id,
            memberId: process.memberId,
            memberName: member.displayName,
            processType: process.processType,
            status: TeamLifecycleProcessStatus.InProgress as const,
            startedAt: process.startedAt?.toISOString() ?? null,
            href: `/team/members/${process.memberId}?tab=lifecycle&process=${process.processType}`,
          },
        ];
      }),
    };
  }

  async getMemberNamesByUserIds(
    context: TeamDashboardContext,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

    if (uniqueUserIds.length === 0) {
      return new Map();
    }

    const members = await this.memberRepository
      .createQueryBuilder('member')
      .where('member.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('member.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('member.user_id IN (:...userIds)', { userIds: uniqueUserIds })
      .getMany();

    return members.reduce<Map<string, string>>((result, member) => {
      if (member.userId) {
        result.set(member.userId, member.displayName);
      }
      return result;
    }, new Map());
  }

  private startOfUtcDay(value: Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
  }

  private endOfUtcDay(value: Date) {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
  }
}
