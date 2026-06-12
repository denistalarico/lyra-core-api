import { Repository } from 'typeorm';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import {
  TeamDepartment,
  TeamMember,
  TeamMemberSkill,
  TeamConfigOption,
  TeamSkill,
} from '../entities';
import {
  TeamMemberStatus,
  TeamSkillLevel,
  TeamWorkerType,
  TeamWorkMode,
} from '../enums';
import { TeamNotificationPublisher } from './team-notification.publisher';
import { TeamService } from './team.service';

describe('TeamService notification triggers', () => {
  it('publishes member_invited only when the new member has a userId', async () => {
    const { service, publisher } = makeService();

    await service.createMember(makeContext(), makeCreateDto({ userId: 'user-member' }));
    expect(publisher.publishMemberInvited).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();

    await service.createMember(makeContext(), makeCreateDto({ userId: undefined }));
    expect(publisher.publishMemberInvited).not.toHaveBeenCalled();
  });

  it('publishes member_activated when status transitions to active', async () => {
    const member = makeMember({ userId: 'user-member', status: TeamMemberStatus.Inactive });
    const { service, publisher } = makeService({ member });

    await service.updateMember(makeContext(), member.id, {
      status: TeamMemberStatus.Active,
    });

    expect(publisher.publishMemberActivated).toHaveBeenCalledTimes(1);
    expect(publisher.publishMemberDeactivated).not.toHaveBeenCalled();
  });

  it('publishes member_deactivated when status transitions to inactive or archived', async () => {
    const member = makeMember({ userId: 'user-member', status: TeamMemberStatus.Active });
    const { service, publisher } = makeService({ member });

    await service.updateMember(makeContext(), member.id, {
      status: TeamMemberStatus.Inactive,
    });

    expect(publisher.publishMemberDeactivated).toHaveBeenCalledTimes(1);
    expect(publisher.publishMemberActivated).not.toHaveBeenCalled();
  });

  it('does not publish status events when status is unchanged', async () => {
    const member = makeMember({ userId: 'user-member', status: TeamMemberStatus.Active });
    const { service, publisher } = makeService({ member });

    await service.updateMember(makeContext(), member.id, {
      status: TeamMemberStatus.Active,
      jobTitle: 'Updated title',
    });

    expect(publisher.publishMemberActivated).not.toHaveBeenCalled();
    expect(publisher.publishMemberDeactivated).not.toHaveBeenCalled();
  });

  it('publishes department_changed and role_changed when those fields change', async () => {
    const member = makeMember({
      userId: 'user-member',
      departmentId: 'dept-old',
      roleName: 'Estagiário',
    });
    const { service, publisher } = makeService({ member });

    await service.updateMember(makeContext(), member.id, {
      departmentId: 'dept-new',
      roleName: 'Designer',
    });

    expect(publisher.publishDepartmentChanged).toHaveBeenCalledWith(
      expect.objectContaining({ previousDepartmentId: 'dept-old' }),
    );
    expect(publisher.publishRoleChanged).toHaveBeenCalledWith(
      expect.objectContaining({ previousRoleName: 'Estagiário' }),
    );
  });

  it('does not publish member events when the member has no userId', async () => {
    const member = makeMember({ userId: null, status: TeamMemberStatus.Active });
    const { service, publisher } = makeService({ member });

    await service.updateMember(makeContext(), member.id, {
      status: TeamMemberStatus.Inactive,
      departmentId: 'dept-new',
      roleName: 'Designer',
    });

    expect(publisher.publishMemberDeactivated).not.toHaveBeenCalled();
    expect(publisher.publishDepartmentChanged).not.toHaveBeenCalled();
    expect(publisher.publishRoleChanged).not.toHaveBeenCalled();
  });

  it('publishes member_deactivated on archive only if not already archived', async () => {
    const member = makeMember({ userId: 'user-member', status: TeamMemberStatus.Active });
    const { service, publisher } = makeService({ member });

    await service.archiveMember(makeContext(), member.id);
    expect(publisher.publishMemberDeactivated).toHaveBeenCalledTimes(1);
  });

  it('does not publish member_deactivated when archiving an already-archived member', async () => {
    const member = makeMember({ userId: 'user-member', status: TeamMemberStatus.Archived });
    const { service, publisher } = makeService({ member });

    await service.archiveMember(makeContext(), member.id);
    expect(publisher.publishMemberDeactivated).not.toHaveBeenCalled();
  });

  it('publishes skill_assigned only when a new member skill is created', async () => {
    const member = makeMember({ userId: 'user-member' });
    const { service, publisher } = makeService({ member, existingMemberSkill: null });

    await service.upsertMemberSkill(makeContext(), member.id, { skillId: 'skill-1' });

    expect(publisher.publishSkillAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishSkillAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'skill-1',
        recipients: [
          expect.objectContaining({ userId: 'user-member' }),
        ],
      }),
    );
  });

  it('does not publish skill_assigned when updating an existing member skill', async () => {
    const member = makeMember({ userId: 'user-member' });
    const existingSkill = {
      id: 'member-skill-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      memberId: member.id,
      skillId: 'skill-1',
      level: TeamSkillLevel.Intermediate,
      notes: null,
      metadata: {},
      createdAt: new Date('2026-06-12T12:00:00.000Z'),
      updatedAt: new Date('2026-06-12T12:00:00.000Z'),
    } as TeamMemberSkill;
    const { service, publisher } = makeService({ member, existingMemberSkill: existingSkill });

    await service.upsertMemberSkill(makeContext(), member.id, { skillId: 'skill-1' });

    expect(publisher.publishSkillAssigned).not.toHaveBeenCalled();
  });
});

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeService(
  options: {
    member?: TeamMember;
    existingMemberSkill?: TeamMemberSkill | null;
  } = {},
) {
  const member = options.member ?? makeMember();

  const memberRepository = {
    findOne: jest.fn().mockResolvedValue(member),
    create: jest.fn((value: Partial<TeamMember>) => ({ ...member, ...value })),
    save: jest.fn(async (value: TeamMember) => value),
  };

  const memberSkillRepository = {
    findOne: jest.fn().mockResolvedValue(options.existingMemberSkill ?? null),
    create: jest.fn((value: Partial<TeamMemberSkill>) => value as TeamMemberSkill),
    save: jest.fn(async (value: Partial<TeamMemberSkill>) => ({
      id: 'member-skill-new',
      createdAt: new Date('2026-06-12T12:00:00.000Z'),
      updatedAt: new Date('2026-06-12T12:00:00.000Z'),
      ...value,
    })),
  };

  const skillRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: 'skill-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
    } as TeamSkill),
  };

  const userProfileRepository = {
    find: jest.fn().mockResolvedValue([]),
  };

  const publisher = {
    publishMemberInvited: jest.fn(),
    publishMemberActivated: jest.fn(),
    publishMemberDeactivated: jest.fn(),
    publishDepartmentChanged: jest.fn(),
    publishRoleChanged: jest.fn(),
    publishSkillAssigned: jest.fn(),
  } as unknown as jest.Mocked<TeamNotificationPublisher>;

  const service = new TeamService(
    {} as Repository<TeamDepartment>,
    skillRepository as unknown as Repository<TeamSkill>,
    {} as Repository<TeamConfigOption>,
    memberRepository as unknown as Repository<TeamMember>,
    memberSkillRepository as unknown as Repository<TeamMemberSkill>,
    userProfileRepository as unknown as Repository<AgencyUserProfileEntity>,
    {} as any,
    publisher,
  );

  return { service, publisher, memberRepository };
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'member-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: null,
    contactId: null,
    contractId: null,
    departmentId: null,
    managerMemberId: null,
    displayName: 'Maria Silva',
    legalName: null,
    email: null,
    phone: null,
    avatarUrl: null,
    jobTitle: null,
    roleName: null,
    seniority: null,
    workerType: TeamWorkerType.Contractor,
    workMode: TeamWorkMode.Flexible,
    status: TeamMemberStatus.Active,
    workLocation: null,
    country: null,
    timezone: null,
    startDate: null,
    endDate: null,
    pinCodeHash: null,
    barcodeValue: null,
    attendanceEnabled: false,
    overtimeApprovalRequired: true,
    hourlyCost: null,
    monthlyCost: null,
    currency: 'USD',
    resumeFileKey: null,
    notes: null,
    createdById: null,
    updatedById: null,
    archivedAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Novo Membro',
    workerType: TeamWorkerType.Contractor,
    workMode: TeamWorkMode.Flexible,
    ...overrides,
  } as any;
}
