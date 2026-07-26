import { Repository } from 'typeorm';
import {
  TeamAttendanceEntry,
  TeamDepartment,
  TeamMember,
  TeamMemberLifecycleProcess,
  TeamMemberPresence,
} from '../entities';
import { TeamLifecycleProcessStatus, TeamLifecycleProcessType } from '../enums';
import { TeamDashboardQueryService } from './team-dashboard-query.service';

describe('TeamDashboardQueryService lifecycle summary', () => {
  it('returns active processes with direct member lifecycle links', async () => {
    const startedAt = new Date('2026-07-26T12:00:00.000Z');
    const member = {
      id: 'member-1',
      displayName: 'Ana Silva',
      status: 'active',
      archivedAt: null,
      attendanceEnabled: false,
      userId: null,
      departmentId: null,
    } as TeamMember;
    const attendanceQuery = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const memberRepository = {
      find: jest.fn().mockResolvedValue([member]),
    };
    const presenceRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const attendanceRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(attendanceQuery),
    };
    const departmentRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const lifecycleProcessRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'process-1',
          memberId: member.id,
          processType: TeamLifecycleProcessType.Onboarding,
          status: TeamLifecycleProcessStatus.InProgress,
          startedAt,
        },
      ]),
    };
    const service = new TeamDashboardQueryService(
      memberRepository as unknown as Repository<TeamMember>,
      presenceRepository as unknown as Repository<TeamMemberPresence>,
      attendanceRepository as unknown as Repository<TeamAttendanceEntry>,
      departmentRepository as unknown as Repository<TeamDepartment>,
      lifecycleProcessRepository as unknown as Repository<TeamMemberLifecycleProcess>,
    );

    const result = await service.getSummary({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
    });

    expect(result.lifecycleProcesses).toEqual([
      {
        id: 'process-1',
        memberId: 'member-1',
        memberName: 'Ana Silva',
        processType: TeamLifecycleProcessType.Onboarding,
        status: TeamLifecycleProcessStatus.InProgress,
        startedAt: startedAt.toISOString(),
        href: '/team/members/member-1?tab=lifecycle&process=onboarding',
      },
    ]);
  });
});
