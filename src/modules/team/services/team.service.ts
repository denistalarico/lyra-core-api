import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  TeamDepartment,
  TeamMember,
  TeamMemberSkill,
  TeamSkill,
} from '../entities';
import {
  CreateTeamDepartmentDto,
  CreateTeamMemberDto,
  CreateTeamSkillDto,
  ListTeamMembersQueryDto,
  UpdateTeamDepartmentDto,
  UpdateTeamMemberDto,
  UpdateTeamSkillDto,
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
    @InjectRepository(TeamMember, 'agency')
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(TeamMemberSkill, 'agency')
    private readonly memberSkillRepository: Repository<TeamMemberSkill>,
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
      icon: dto.icon ?? null,
      managerMemberId: dto.managerMemberId ?? null,
      parentDepartmentId: dto.parentDepartmentId ?? null,
      status: TeamRecordStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.departmentRepository.save(entity);
  }

  async updateDepartment(ctx: RequestContext, id: string, dto: UpdateTeamDepartmentDto) {
    const entity = await this.findDepartment(ctx, id);

    if (dto.name !== undefined) {
      entity.name = dto.name;
      entity.slug = slugify(dto.name);
    }

    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.color !== undefined) entity.color = dto.color;
    if (dto.icon !== undefined) entity.icon = dto.icon;
    if (dto.managerMemberId !== undefined) entity.managerMemberId = dto.managerMemberId;
    if (dto.parentDepartmentId !== undefined) entity.parentDepartmentId = dto.parentDepartmentId;
    if (dto.status !== undefined) entity.status = dto.status;

    return this.departmentRepository.save(entity);
  }

  async archiveDepartment(ctx: RequestContext, id: string) {
    const entity = await this.findDepartment(ctx, id);
    entity.status = TeamRecordStatus.Archived;
    return this.departmentRepository.save(entity);
  }

  listSkills(ctx: RequestContext) {
    return this.skillRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { category: 'ASC', position: 'ASC', name: 'ASC' },
    });
  }

  createSkill(ctx: RequestContext, dto: CreateTeamSkillDto) {
    const entity = this.skillRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: dto.name,
      slug: slugify(dto.name),
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

  listMembers(ctx: RequestContext, query: ListTeamMembersQueryDto) {
    return this.memberRepository.find({
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
  }

  async getMember(ctx: RequestContext, id: string) {
    const member = await this.findMember(ctx, id);
    const skills = await this.memberSkillRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, memberId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      ...member,
      skills,
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
      status: TeamMemberStatus.Active,
      createdById: ctx.userId || null,
    });

    return this.memberRepository.save(entity);
  }

  async updateMember(ctx: RequestContext, id: string, dto: UpdateTeamMemberDto) {
    const entity = await this.findMember(ctx, id);

    Object.assign(entity, {
      ...dto,
      updatedById: ctx.userId || null,
    });

    return this.memberRepository.save(entity);
  }

  async archiveMember(ctx: RequestContext, id: string) {
    const entity = await this.findMember(ctx, id);
    entity.status = TeamMemberStatus.Archived;
    entity.archivedAt = new Date();
    entity.updatedById = ctx.userId || null;
    return this.memberRepository.save(entity);
  }

  async upsertMemberSkill(ctx: RequestContext, memberId: string, dto: UpsertTeamMemberSkillDto) {
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
      }),
    );
  }

  async removeMemberSkill(ctx: RequestContext, memberId: string, skillId: string) {
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
