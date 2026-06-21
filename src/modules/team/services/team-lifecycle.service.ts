import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TeamConfigOption,
  TeamDepartment,
  TeamMember,
  TeamMemberLifecycleProcess,
  TeamMemberLifecycleStep,
} from '../entities';
import { AgencyActivityLink } from '../../activities/entities';
import { ActivityEntityType } from '../../activities/enums';
import {
  CreateTeamMemberLifecycleStepDto,
  StartTeamMemberLifecycleDto,
  UpdateTeamMemberLifecycleStepDto,
} from '../dto';
import {
  TeamLifecycleIntervalUnit,
  TeamLifecycleProcessStatus,
  TeamLifecycleProcessType,
  TeamLifecycleStepStatus,
} from '../enums';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const STEP_CONFIG_TYPE_BY_PROCESS: Record<TeamLifecycleProcessType, 'onboarding_task' | 'offboarding_task'> = {
  [TeamLifecycleProcessType.Onboarding]: 'onboarding_task',
  [TeamLifecycleProcessType.Offboarding]: 'offboarding_task',
};

function addInterval(base: Date, value: number, unit: TeamLifecycleIntervalUnit): Date {
  const result = new Date(base);
  if (unit === TeamLifecycleIntervalUnit.Hours) {
    result.setHours(result.getHours() + value);
  } else if (unit === TeamLifecycleIntervalUnit.Weeks) {
    result.setDate(result.getDate() + value * 7);
  } else {
    result.setDate(result.getDate() + value);
  }
  return result;
}

@Injectable()
export class TeamLifecycleService {
  constructor(
    @InjectRepository(TeamMember, 'agency')
    private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(TeamConfigOption, 'agency')
    private readonly configOptionRepository: Repository<TeamConfigOption>,
    @InjectRepository(TeamDepartment, 'agency')
    private readonly departmentRepository: Repository<TeamDepartment>,
    @InjectRepository(TeamMemberLifecycleProcess, 'agency')
    private readonly processRepository: Repository<TeamMemberLifecycleProcess>,
    @InjectRepository(TeamMemberLifecycleStep, 'agency')
    private readonly stepRepository: Repository<TeamMemberLifecycleStep>,
    @InjectRepository(AgencyActivityLink, 'agency')
    private readonly activityLinkRepository: Repository<AgencyActivityLink>,
  ) {}

  async getLifecycle(
    ctx: RequestContext,
    memberId: string,
    processType: TeamLifecycleProcessType,
  ) {
    const member = await this.findMember(ctx, memberId);
    const process = await this.findActiveProcess(ctx, memberId, processType);

    if (!process) {
      const hasTemplate = await this.hasConfiguredSteps(ctx, processType, member.departmentId);
      return { process: null, steps: [], hasTemplate };
    }

    const steps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId: process.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const activityCounts = await this.countActivitiesByStep(
      ctx,
      steps.map((step) => step.id),
    );

    return {
      process,
      steps: steps.map((step) => ({
        ...step,
        activityCount: activityCounts.get(step.id) ?? 0,
      })),
    };
  }

  async startLifecycle(
    ctx: RequestContext,
    memberId: string,
    processType: TeamLifecycleProcessType,
    dto: StartTeamMemberLifecycleDto,
  ) {
    const existing = await this.findActiveProcess(ctx, memberId, processType);
    if (existing) {
      return this.getLifecycle(ctx, memberId, processType);
    }

    const member = await this.findMember(ctx, memberId);

    await this.processRepository.save(
      this.processRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        processType,
        status: TeamLifecycleProcessStatus.InProgress,
        departmentId: dto.departmentId ?? member.departmentId ?? null,
        startedAt: new Date(),
        createdById: ctx.userId || null,
        updatedById: ctx.userId || null,
      }),
    );

    return this.applyTemplate(ctx, memberId, processType);
  }

  async applyTemplate(
    ctx: RequestContext,
    memberId: string,
    processType: TeamLifecycleProcessType,
  ) {
    const member = await this.findMember(ctx, memberId);
    let process = await this.findActiveProcess(ctx, memberId, processType);

    if (!process) {
      process = await this.processRepository.save(
        this.processRepository.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          memberId,
          processType,
          status: TeamLifecycleProcessStatus.InProgress,
          departmentId: member.departmentId ?? null,
          startedAt: new Date(),
          createdById: ctx.userId || null,
          updatedById: ctx.userId || null,
        }),
      );
    }

    const configType = STEP_CONFIG_TYPE_BY_PROCESS[processType];
    const configuredSteps = await this.loadConfiguredSteps(ctx, configType, member.departmentId);

    const existingSteps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId: process.id },
    });
    const existingSourceIds = new Set(
      existingSteps.map((step) => step.sourceConfigOptionId).filter((id): id is string => Boolean(id)),
    );

    const newSteps = configuredSteps.filter((option) => !existingSourceIds.has(option.id));

    if (newSteps.length > 0) {
      const maxSortOrder = existingSteps.reduce((max, step) => Math.max(max, step.sortOrder), -1);

      const created = await Promise.all(
        newSteps.map((option, index) =>
          this.buildStepFromConfig(ctx, process!, member, option, maxSortOrder + 1 + index),
        ),
      );

      await this.stepRepository.save(created);
    }

    return this.getLifecycle(ctx, memberId, processType);
  }

  async completeLifecycle(
    ctx: RequestContext,
    memberId: string,
    processType: TeamLifecycleProcessType,
  ) {
    const process = await this.findActiveProcess(ctx, memberId, processType);
    if (!process) {
      throw new BadRequestException('Processo não iniciado.');
    }

    const steps = await this.stepRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        processId: process.id,
      },
    });

    const pendingSteps = steps.filter(
      (step) =>
        step.status !== TeamLifecycleStepStatus.Done &&
        step.status !== TeamLifecycleStepStatus.Skipped,
    );
    if (pendingSteps.length > 0) {
      await this.stepRepository.save(
        pendingSteps.map((step) => ({
          ...step,
          status: TeamLifecycleStepStatus.Done,
          updatedById: ctx.userId || null,
        })),
      );
    }

    process.status = TeamLifecycleProcessStatus.Completed;
    process.completedAt = new Date();
    process.updatedById = ctx.userId || null;
    await this.processRepository.save(process);

    return this.getLifecycle(ctx, memberId, processType);
  }

  async createStep(
    ctx: RequestContext,
    memberId: string,
    processType: TeamLifecycleProcessType,
    dto: CreateTeamMemberLifecycleStepDto,
  ) {
    const process = await this.findActiveProcess(ctx, memberId, processType);
    if (!process) {
      throw new BadRequestException('Inicie o processo antes de adicionar etapas.');
    }

    const lastStep = await this.stepRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        processId: process.id,
      },
      order: { sortOrder: 'DESC' },
    });

    const intervalValue = dto.intervalValue ?? null;
    const intervalUnit = dto.intervalUnit ?? null;
    const member = await this.findMember(ctx, memberId);
    const assignment = dto.assignment ?? 'member';
    const assigneeLabel = await this.resolveAssigneeLabel(ctx, assignment, member);
    const dueAt =
      intervalValue != null && intervalUnit
        ? addInterval(process.startedAt ?? new Date(), intervalValue, intervalUnit)
        : null;

    const step = await this.stepRepository.save(
      this.stepRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        processId: process.id,
        memberId,
        sourceConfigOptionId: null,
        stepTypeId: dto.stepTypeId ?? null,
        title: dto.title.trim(),
        description: dto.description ?? null,
        assigneeLabel: dto.assigneeLabel ?? assigneeLabel,
        assigneeMemberId: null,
        intervalValue,
        intervalUnit,
        dueAt,
        status: TeamLifecycleStepStatus.NotStarted,
        notes: dto.notes ?? null,
        sortOrder: (lastStep?.sortOrder ?? -1) + 1,
        createdById: ctx.userId || null,
        updatedById: ctx.userId || null,
        metadata: { customizedForMember: true, assignment },
      }),
    );

    if (process.status === TeamLifecycleProcessStatus.Completed) {
      process.status = TeamLifecycleProcessStatus.InProgress;
      process.completedAt = null;
      process.updatedById = ctx.userId || null;
      await this.processRepository.save(process);
    }

    return step;
  }

  async deleteStep(ctx: RequestContext, memberId: string, stepId: string) {
    const step = await this.stepRepository.findOne({
      where: {
        id: stepId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
      },
    });
    if (!step) {
      throw new NotFoundException('Etapa não encontrada.');
    }

    await this.stepRepository.remove(step);
    await this.maybeCompleteProcess(ctx, step.processId);
    return { success: true };
  }

  async updateStep(
    ctx: RequestContext,
    memberId: string,
    stepId: string,
    dto: UpdateTeamMemberLifecycleStepDto,
  ) {
    const step = await this.stepRepository.findOne({
      where: {
        id: stepId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
      },
    });

    if (!step) {
      throw new NotFoundException('Etapa não encontrada.');
    }

    if (dto.title !== undefined) step.title = dto.title;
    if (dto.description !== undefined) step.description = dto.description;
    if (dto.stepTypeId !== undefined) step.stepTypeId = dto.stepTypeId;
    if (dto.assigneeLabel !== undefined) step.assigneeLabel = dto.assigneeLabel;
    if (dto.assigneeMemberId !== undefined) step.assigneeMemberId = dto.assigneeMemberId;
    if (dto.assignment !== undefined) {
      const member = await this.findMember(ctx, memberId);
      const assignment = dto.assignment ?? '';
      step.assigneeLabel = await this.resolveAssigneeLabel(ctx, assignment, member);
      step.metadata = { ...(step.metadata ?? {}), assignment };
    }
    if (dto.intervalValue !== undefined) step.intervalValue = dto.intervalValue;
    if (dto.intervalUnit !== undefined) step.intervalUnit = dto.intervalUnit;
    if (dto.notes !== undefined) step.notes = dto.notes;
    if (dto.sortOrder !== undefined) step.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) step.status = dto.status;

    step.updatedById = ctx.userId || null;

    const saved = await this.stepRepository.save(step);

    await this.maybeCompleteProcess(ctx, step.processId);

    return saved;
  }

  private async maybeCompleteProcess(ctx: RequestContext, processId: string) {
    const steps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId },
    });

    if (steps.length === 0) return;

    const allResolved = steps.every(
      (step) =>
        step.status === TeamLifecycleStepStatus.Done || step.status === TeamLifecycleStepStatus.Skipped,
    );

    const process = await this.processRepository.findOne({
      where: { id: processId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!process) return;

    // A conclusão é uma ação explícita e confirmada pela interface. Aqui apenas
    // reabrimos um processo concluído caso uma etapa volte a ficar pendente.
    if (!allResolved && process.status === TeamLifecycleProcessStatus.Completed) {
      process.status = TeamLifecycleProcessStatus.InProgress;
      process.completedAt = null;
      await this.processRepository.save(process);
    }
  }

  private async buildStepFromConfig(
    ctx: RequestContext,
    process: TeamMemberLifecycleProcess,
    member: TeamMember,
    option: TeamConfigOption,
    sortOrder: number,
  ): Promise<TeamMemberLifecycleStep> {
    const metadata = (option.metadata ?? {}) as Record<string, unknown>;
    const intervalValue = typeof metadata.intervalValue === 'number' ? metadata.intervalValue : null;
    const intervalUnit =
      metadata.intervalUnit === 'days' || metadata.intervalUnit === 'weeks' || metadata.intervalUnit === 'hours'
        ? (metadata.intervalUnit as TeamLifecycleIntervalUnit)
        : null;

    const baseDate = member.startDate ? new Date(member.startDate) : null;
    const dueAt =
      baseDate && intervalValue !== null && intervalUnit
        ? addInterval(baseDate, intervalValue, intervalUnit)
        : null;

    const assignment = String(metadata.assignment ?? '');
    const assigneeLabel = await this.resolveAssigneeLabel(ctx, assignment, member);

    return this.stepRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      processId: process.id,
      memberId: member.id,
      sourceConfigOptionId: option.id,
      stepTypeId: typeof metadata.stepTypeId === 'string' ? metadata.stepTypeId : null,
      title: option.name,
      description: typeof metadata.note === 'string' ? metadata.note : null,
      assigneeLabel,
      assigneeMemberId: null,
      intervalValue,
      intervalUnit,
      dueAt,
      status: TeamLifecycleStepStatus.NotStarted,
      sortOrder,
      createdById: ctx.userId || null,
      updatedById: ctx.userId || null,
      metadata: { assignment },
    });
  }

  private async resolveAssigneeLabel(
    ctx: RequestContext,
    assignment: string,
    member: TeamMember,
  ): Promise<string | null> {
    if (assignment === 'manager') {
      if (!member.managerMemberId) return 'Gestor';
      const manager = await this.memberRepository.findOne({
        where: { id: member.managerMemberId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      });
      return manager?.displayName ?? 'Gestor';
    }

    if (assignment === 'member') {
      return member.displayName ?? 'Colaborador';
    }

    if (assignment === 'admin') {
      return 'Administrador';
    }

    if (assignment.startsWith('department:')) {
      const departmentId = assignment.slice('department:'.length);
      const department = await this.departmentRepository.findOne({
        where: {
          id: departmentId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
      return department?.name ?? 'Departamento';
    }

    return assignment || null;
  }

  private async loadConfiguredSteps(
    ctx: RequestContext,
    configType: 'onboarding_task' | 'offboarding_task',
    departmentId: string | null,
  ): Promise<TeamConfigOption[]> {
    const all = await this.configOptionRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: configType, status: 'active' },
    });

    const byDepartment = departmentId
      ? all.filter((option) => (option.metadata as Record<string, unknown> | null)?.departmentId === departmentId)
      : [];

    const global = all.filter((option) => !(option.metadata as Record<string, unknown> | null)?.departmentId);

    const steps = byDepartment.length > 0 ? byDepartment : global;

    return steps.sort((a, b) => {
      const orderA = Number((a.metadata as Record<string, unknown> | null)?.order ?? 0);
      const orderB = Number((b.metadata as Record<string, unknown> | null)?.order ?? 0);
      return orderA - orderB;
    });
  }

  private async hasConfiguredSteps(
    ctx: RequestContext,
    processType: TeamLifecycleProcessType,
    departmentId: string | null,
  ): Promise<boolean> {
    const configType = STEP_CONFIG_TYPE_BY_PROCESS[processType];
    const steps = await this.loadConfiguredSteps(ctx, configType, departmentId);
    return steps.length > 0;
  }

  private async countActivitiesByStep(
    ctx: RequestContext,
    stepIds: string[],
  ): Promise<Map<string, number>> {
    if (stepIds.length === 0) return new Map();

    const links = await this.activityLinkRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        entityType: ActivityEntityType.TeamLifecycleStep,
        entityId: In(stepIds),
      },
    });

    const counts = new Map<string, number>();
    for (const link of links) {
      counts.set(link.entityId, (counts.get(link.entityId) ?? 0) + 1);
    }
    return counts;
  }

  private async findActiveProcess(
    ctx: RequestContext,
    memberId: string,
    processType: TeamLifecycleProcessType,
  ) {
    return this.processRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId,
        processType,
        status: In([TeamLifecycleProcessStatus.InProgress, TeamLifecycleProcessStatus.Completed]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async findMember(ctx: RequestContext, id: string) {
    const member = await this.memberRepository.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!member) {
      throw new BadRequestException('Membro não encontrado.');
    }

    return member;
  }
}
