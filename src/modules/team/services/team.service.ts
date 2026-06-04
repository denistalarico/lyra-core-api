import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { FilesService } from '../../../common/files/files.service';
import {
  TeamDepartment,
  TeamMember,
  TeamMemberSkill,
  TeamSkill,
  TeamConfigOption,
} from '../entities';
import {
  CreateTeamDepartmentDto,
  CreateTeamMemberDto,
  CreateTeamSkillDto,
  ListTeamMembersQueryDto,
  UpdateTeamDepartmentDto,
  UpdateTeamMemberDto,
  UpdateTeamSkillDto,
  CreateTeamConfigOptionDto,
  UpdateTeamConfigOptionDto,
  UpsertTeamMemberSkillDto,
} from '../dto';
import {
  TeamAttendanceSource,
  TeamAttendanceType,
  TeamMemberStatus,
  TeamPresenceSource,
  TeamPresenceStatus,
  TeamRecordStatus,
  TeamSkillLevel,
} from '../enums';
import { TEAM_DEFAULT_DEPARTMENTS, TEAM_DEFAULT_SKILLS } from './team-defaults';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function hashPinCode(tenantId: string, workspaceId: string, pinCode: string) {
  return createHash('sha256')
    .update(`${tenantId}:${workspaceId}:${pinCode}`)
    .digest('hex');
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(TeamDepartment, 'agency')
    private readonly departmentRepository: Repository<TeamDepartment>,
    @InjectRepository(TeamSkill, 'agency')
    private readonly skillRepository: Repository<TeamSkill>,
    @InjectRepository(TeamConfigOption, 'agency')
    private readonly configOptionRepository: Repository<TeamConfigOption>,
    @InjectRepository(TeamMember, 'agency')
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(TeamMemberSkill, 'agency')
    private readonly memberSkillRepository: Repository<TeamMemberSkill>,
    @InjectRepository(AgencyUserProfileEntity, 'agency')
    private readonly userProfileRepository: Repository<AgencyUserProfileEntity>,
    private readonly filesService: FilesService,
  ) {}

  health() {
    return {
      module: 'team',
      status: 'ok',
    };
  }

  async seedDefaults(ctx: RequestContext) {
    let departmentsCreated = 0;
    let skillsCreated = 0;

    for (const [slug, name, description] of TEAM_DEFAULT_DEPARTMENTS) {
      const existing = await this.departmentRepository.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, slug },
      });

      if (!existing) {
        await this.departmentRepository.save(
          this.departmentRepository.create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            slug,
            name,
            description,
            isSystemDefault: true,
            status: TeamRecordStatus.Active,
            createdById: ctx.userId || null,
            position: departmentsCreated,
          }),
        );
        departmentsCreated += 1;
      }
    }

    for (const [slug, name, category] of TEAM_DEFAULT_SKILLS) {
      const existing = await this.skillRepository.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, slug },
      });

      if (!existing) {
        await this.skillRepository.save(
          this.skillRepository.create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            slug,
            name,
            category,
            isSystemDefault: true,
            status: TeamRecordStatus.Active,
            createdById: ctx.userId || null,
            position: skillsCreated,
          }),
        );
        skillsCreated += 1;
      }
    }

    return {
      departmentsCreated,
      skillsCreated,
    };
  }

  listDepartments(ctx: RequestContext) {
    return this.departmentRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { position: 'ASC', name: 'ASC' },
    });
  }

  createDepartment(ctx: RequestContext, dto: CreateTeamDepartmentDto) {
    const entity = this.departmentRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: dto.name,
      slug: slugify(dto.name),
      description: dto.description ?? null,
      color: dto.color ?? null,
      metadata: dto.metadata ?? {},
      icon: dto.icon ?? null,
      managerMemberId: dto.managerMemberId ?? null,
      parentDepartmentId: dto.parentDepartmentId ?? null,
      status: TeamRecordStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.departmentRepository.save(entity);
  }

  async updateDepartment(
    ctx: RequestContext,
    id: string,
    dto: UpdateTeamDepartmentDto,
  ) {
    const entity = await this.findDepartment(ctx, id);

    if (dto.name !== undefined) {
      entity.name = dto.name;
      entity.slug = slugify(dto.name);
    }

    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.color !== undefined) entity.color = dto.color;
    if (dto.icon !== undefined) entity.icon = dto.icon;
    if (dto.managerMemberId !== undefined)
      entity.managerMemberId = dto.managerMemberId;
    if (dto.parentDepartmentId !== undefined)
      entity.parentDepartmentId = dto.parentDepartmentId;
    if (dto.status !== undefined) entity.status = dto.status;

    return this.departmentRepository.save(entity);
  }

  async archiveDepartment(ctx: RequestContext, id: string) {
    const entity = await this.findDepartment(ctx, id);
    entity.status = TeamRecordStatus.Archived;
    return this.departmentRepository.save(entity);
  }

  async deleteDepartment(ctx: RequestContext, id: string) {
    const entity = await this.findDepartment(ctx, id);
    await this.departmentRepository.remove(entity);
    return { deleted: true, id };
  }

  listSkills(ctx: RequestContext) {
    return this.skillRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, status: TeamRecordStatus.Active },
      order: { category: 'ASC', position: 'ASC', name: 'ASC' },
    });
  }

  createSkill(ctx: RequestContext, dto: CreateTeamSkillDto) {
    const entity = this.skillRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: dto.name,
      slug: slugify(`${dto.category}-${dto.name}`),
      category: dto.category,
      description: dto.description ?? null,
      color: dto.color ?? null,
      status: TeamRecordStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.skillRepository.save(entity);
  }

  async updateSkill(ctx: RequestContext, id: string, dto: UpdateTeamSkillDto) {
    const entity = await this.findSkill(ctx, id);

    if (dto.name !== undefined) {
      entity.name = dto.name;
      entity.slug = slugify(dto.name);
    }

    if (dto.category !== undefined) entity.category = dto.category;
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.color !== undefined) entity.color = dto.color;
    if (dto.status !== undefined) entity.status = dto.status;

    return this.skillRepository.save(entity);
  }

  async archiveSkill(ctx: RequestContext, id: string) {
    const entity = await this.findSkill(ctx, id);
    entity.status = TeamRecordStatus.Archived;
    return this.skillRepository.save(entity);
  }

  async listMembers(ctx: RequestContext, query: ListTeamMembersQueryDto) {
    const members = await this.memberRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.workerType ? { workerType: query.workerType } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.search ? { displayName: ILike(`%${query.search}%`) } : {}),
      },
      order: { displayName: 'ASC' },
    });

    return this.withUserProfileAvatars(ctx, members);
  }

  async getMember(ctx: RequestContext, id: string) {
    const member = await this.findMember(ctx, id);
    const [memberWithAvatar] = await this.withUserProfileAvatars(ctx, [member]);
    const skills = await this.memberSkillRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId: id,
      },
      order: { createdAt: 'ASC' },
    });

    return {
      ...memberWithAvatar,
      skills,
    };
  }

  private async withUserProfileAvatars(
    ctx: RequestContext,
    members: TeamMember[],
  ) {
    const userIds = members
      .map((member) => member.userId)
      .filter((userId): userId is string => Boolean(userId));

    if (userIds.length === 0) {
      return members;
    }

    const profiles = await this.userProfileRepository.find({
      where: {
        tenantId: ctx.tenantId,
        userId: In(userIds),
      },
    });

    const profileByUserId = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    );

    return members.map((member) => {
      const profile = member.userId
        ? profileByUserId.get(member.userId)
        : undefined;
      const profileAvatarUrl = profile?.avatarUrl ?? null;
      const memberAvatarUrl = member.avatarUrl ?? null;
      const shouldUseProfileAvatar =
        Boolean(profileAvatarUrl) &&
        (!memberAvatarUrl ||
          memberAvatarUrl.includes('/users/') ||
          memberAvatarUrl.includes(`/users/${member.userId}/`));

      if (!shouldUseProfileAvatar) {
        return member;
      }

      return {
        ...member,
        avatarUrl: profileAvatarUrl,
        avatarPath: profile?.avatarPath ?? null,
      };
    });
  }

  listConfigOptions(
    ctx: RequestContext,
    type?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      status: 'active',
    };

    if (type) where.type = type;

    return this.configOptionRepository.find({ where, order: { name: 'ASC' } });
  }

  async createConfigOption(
    ctx: RequestContext,
    dto: CreateTeamConfigOptionDto,
  ) {
    const name = dto.name.trim();
    const metadata = dto.metadata ?? {};

    // For seniority, uniqueness is scoped by skillCategory — find only within the same category
    const skillCategory =
      dto.type === 'seniority' &&
      metadata &&
      typeof (metadata as Record<string, unknown>).skillCategory === 'string'
        ? (metadata as Record<string, unknown>).skillCategory
        : undefined;

    const allByName = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: dto.type,
        name,
      },
    });

    const existing = skillCategory
      ? allByName.find(
          (o) =>
            o.metadata &&
            (o.metadata as Record<string, unknown>).skillCategory === skillCategory,
        )
      : allByName[0];

    if (existing) {
      existing.status = 'active';
      existing.updatedById = ctx.userId || null;
      existing.metadata = metadata;
      return this.configOptionRepository.save(existing);
    }

    return this.configOptionRepository.save(
      this.configOptionRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: dto.type,
        name,
        status: 'active',
        metadata,
        createdById: ctx.userId || null,
        updatedById: ctx.userId || null,
      }),
    );
  }

  async updateConfigOption(
    ctx: RequestContext,
    id: string,
    dto: UpdateTeamConfigOptionDto,
  ) {
    const entity = await this.configOptionRepository.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!entity) {
      throw new NotFoundException('Config option not found');
    }

    if (dto.type !== undefined) {
      entity.type = dto.type;
    }

    if (dto.name !== undefined) {
      entity.name = dto.name;
    }

    if (dto.description !== undefined) {
      entity.description = dto.description ?? null;
    }

    if (dto.color !== undefined) {
      entity.color = dto.color ?? null;
    }

    if (dto.metadata !== undefined) {
      entity.metadata = dto.metadata ?? {};
    }

    if (dto.status !== undefined) {
      entity.status = dto.status;
    }

    entity.updatedById = ctx.userId || null;

    return this.configOptionRepository.save(entity);
  }

  async deleteConfigOption(ctx: RequestContext, id: string) {
    const option = await this.configOptionRepository.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!option) {
      throw new NotFoundException('Team config option not found');
    }

    await this.configOptionRepository.remove(option);

    return {
      deleted: true,
      id,
    };
  }

  createMember(ctx: RequestContext, dto: CreateTeamMemberDto) {
    const entity = this.memberRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      displayName: dto.displayName,
      legalName: dto.legalName ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      avatarUrl: dto.avatarUrl ?? null,
      userId: dto.userId ?? null,
      contactId: dto.contactId ?? null,
      contractId: dto.contractId ?? null,
      departmentId: dto.departmentId ?? null,
      managerMemberId: dto.managerMemberId ?? null,
      jobTitle: dto.jobTitle ?? null,
      roleName: dto.roleName ?? null,
      seniority: dto.seniority ?? null,
      workerType: dto.workerType,
      workMode: dto.workMode,
      workLocation: dto.workLocation ?? null,
      country: dto.country ?? null,
      timezone: dto.timezone ?? null,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      attendanceEnabled: dto.attendanceEnabled ?? false,
      overtimeApprovalRequired: dto.overtimeApprovalRequired ?? true,
      hourlyCost: dto.hourlyCost ?? null,
      monthlyCost: dto.monthlyCost ?? null,
      currency: dto.currency ?? 'USD',
      notes: dto.notes ?? null,
      status: dto.status ?? TeamMemberStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.memberRepository.save(entity);
  }

  async updateMember(
    ctx: RequestContext,
    id: string,
    dto: UpdateTeamMemberDto,
  ) {
    const entity = await this.findMember(ctx, id);

    Object.assign(entity, {
      ...dto,
      updatedById: ctx.userId || null,
    });

    return this.memberRepository.save(entity);
  }

  async uploadMemberAvatar(
    ctx: RequestContext,
    memberId: string,
    file: Express.Multer.File,
  ) {
    const member = await this.findMember(ctx, memberId);
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `agency/tenants/${ctx.tenantId}/workspaces/${ctx.workspaceId}/team/members/${memberId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

    member.avatarUrl = stored.url;
    member.updatedById = ctx.userId || null;

    await this.memberRepository.save(member);

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
  }

  async archiveMember(ctx: RequestContext, id: string) {
    const entity = await this.findMember(ctx, id);
    entity.status = TeamMemberStatus.Archived;
    entity.archivedAt = new Date();
    entity.updatedById = ctx.userId || null;
    return this.memberRepository.save(entity);
  }

  async deleteMember(ctx: RequestContext, id: string) {
    const entity = await this.findMember(ctx, id);

    await this.memberRepository.remove(entity);

    return {
      deleted: true,
      id,
    };
  }

  async upsertMemberSkill(
    ctx: RequestContext,
    memberId: string,
    dto: UpsertTeamMemberSkillDto,
  ) {
    await this.findMember(ctx, memberId);
    await this.findSkill(ctx, dto.skillId);

    const existing = await this.memberSkillRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        skillId: dto.skillId,
      },
    });

    if (existing) {
      existing.level = dto.level ?? existing.level;
      existing.notes = dto.notes ?? existing.notes;
      existing.metadata = {
        ...(existing.metadata ?? {}),
        ...(dto.metadata ?? {}),
      };
      return this.memberSkillRepository.save(existing);
    }

    return this.memberSkillRepository.save(
      this.memberSkillRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        skillId: dto.skillId,
        level: dto.level ?? TeamSkillLevel.Intermediate,
        notes: dto.notes ?? null,
        metadata: dto.metadata ?? {},
      }),
    );
  }

  async removeMemberSkill(
    ctx: RequestContext,
    memberId: string,
    skillId: string,
  ) {
    const existing = await this.memberSkillRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        skillId,
      },
    });

    if (!existing) return { deleted: false };

    await this.memberSkillRepository.delete(existing.id);
    return { deleted: true };
  }

  private async findDepartment(ctx: RequestContext, id: string) {
    const entity = await this.departmentRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, id },
    });

    if (!entity) throw new NotFoundException('Department not found');
    return entity;
  }

  private async findSkill(ctx: RequestContext, id: string) {
    const entity = await this.skillRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, id },
    });

    if (!entity) throw new NotFoundException('Skill not found');
    return entity;
  }

  private async findMember(ctx: RequestContext, id: string) {
    const entity = await this.memberRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, id },
    });

    if (!entity) throw new NotFoundException('Team member not found');
    return entity;
  }
}
