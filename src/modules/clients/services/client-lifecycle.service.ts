import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgencyClient, ClientLifecycleProcess, ClientLifecycleStep } from '../entities';
import { TeamConfigOption } from '../../team/entities';
import { AgencyActivityLink } from '../../activities/entities';
import { ActivityEntityType } from '../../activities/enums';
import {
  CompleteClientLifecycleDto,
  CreateClientLifecycleStepDto,
  StartClientLifecycleDto,
  UpdateClientLifecycleStepDto,
} from '../dto';
import {
  AgencyClientStatus,
  ClientLifecycleIntervalUnit,
  ClientLifecycleProcessStatus,
  ClientLifecycleProcessType,
  ClientLifecycleStepStatus,
} from '../enums';
import { ClientNotificationPublisher } from './client-notification.publisher';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const STEP_CONFIG_TYPE_BY_PROCESS: Record<
  ClientLifecycleProcessType,
  'client_onboarding_task' | 'client_offboarding_task'
> = {
  [ClientLifecycleProcessType.Onboarding]: 'client_onboarding_task',
  [ClientLifecycleProcessType.Offboarding]: 'client_offboarding_task',
};

function addInterval(base: Date, value: number, unit: ClientLifecycleIntervalUnit): Date {
  const result = new Date(base);
  if (unit === ClientLifecycleIntervalUnit.Hours) {
    result.setHours(result.getHours() + value);
  } else if (unit === ClientLifecycleIntervalUnit.Weeks) {
    result.setDate(result.getDate() + value * 7);
  } else {
    result.setDate(result.getDate() + value);
  }
  return result;
}

type TemplateStepSnapshot = {
  id?: string;
  name: string;
  stepTypeId?: string | null;
  assignment?: string | null;
  intervalValue?: number | null;
  intervalUnit?: string | null;
  note?: string | null;
  order?: number;
};

@Injectable()
export class ClientLifecycleService {
  constructor(
    @InjectRepository(AgencyClient, 'agency')
    private readonly clientRepository: Repository<AgencyClient>,
    @InjectRepository(TeamConfigOption, 'agency')
    private readonly configOptionRepository: Repository<TeamConfigOption>,
    @InjectRepository(ClientLifecycleProcess, 'agency')
    private readonly processRepository: Repository<ClientLifecycleProcess>,
    @InjectRepository(ClientLifecycleStep, 'agency')
    private readonly stepRepository: Repository<ClientLifecycleStep>,
    @InjectRepository(AgencyActivityLink, 'agency')
    private readonly activityLinkRepository: Repository<AgencyActivityLink>,
    private readonly clientNotificationPublisher: ClientNotificationPublisher,
  ) {}

  async getLifecycle(ctx: RequestContext, clientId: string, processType: ClientLifecycleProcessType) {
    await this.findClient(ctx, clientId);
    const process = await this.findActiveProcess(ctx, clientId, processType);

    if (!process) {
      const hasTemplate = await this.hasConfiguredSteps(ctx, processType);
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

  async getHistory(ctx: RequestContext, clientId: string) {
    await this.findClient(ctx, clientId);
    return this.processRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, clientId },
      order: { createdAt: 'DESC' },
    });
  }

  async startLifecycle(
    ctx: RequestContext,
    clientId: string,
    processType: ClientLifecycleProcessType,
    dto: StartClientLifecycleDto,
  ) {
    const existing = await this.findActiveProcess(ctx, clientId, processType);
    if (existing) {
      return this.getLifecycle(ctx, clientId, processType);
    }

    const client = await this.findClient(ctx, clientId);

    const process = await this.processRepository.save(
      this.processRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        clientId,
        processType,
        status: ClientLifecycleProcessStatus.InProgress,
        templateConfigOptionId: dto.templateConfigOptionId ?? null,
        startedAt: new Date(),
        createdById: ctx.userId || null,
        updatedById: ctx.userId || null,
      }),
    );

    if (dto.templateConfigOptionId) {
      await this.applyExplicitTemplate(ctx, process, dto.templateConfigOptionId);
    } else {
      await this.applyConfiguredTasks(ctx, process, processType);
    }

    if (processType === ClientLifecycleProcessType.Onboarding) {
      await this.clientNotificationPublisher.publishOnboardingStarted({ client, actorUserId: ctx.userId });
    } else {
      await this.clientNotificationPublisher.publishOffboardingStarted({ client, actorUserId: ctx.userId });
    }

    return this.getLifecycle(ctx, clientId, processType);
  }

  async applyTemplate(
    ctx: RequestContext,
    clientId: string,
    processType: ClientLifecycleProcessType,
    templateConfigOptionId?: string,
  ) {
    let process = await this.findActiveProcess(ctx, clientId, processType);

    if (!process) {
      await this.findClient(ctx, clientId);
      process = await this.processRepository.save(
        this.processRepository.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          clientId,
          processType,
          status: ClientLifecycleProcessStatus.InProgress,
          templateConfigOptionId: templateConfigOptionId ?? null,
          startedAt: new Date(),
          createdById: ctx.userId || null,
          updatedById: ctx.userId || null,
        }),
      );
    }

    if (templateConfigOptionId) {
      await this.applyExplicitTemplate(ctx, process, templateConfigOptionId);
    } else {
      await this.applyConfiguredTasks(ctx, process, processType);
    }

    return this.getLifecycle(ctx, clientId, processType);
  }

  async cancelLifecycle(ctx: RequestContext, clientId: string, processType: ClientLifecycleProcessType) {
    const process = await this.findActiveProcess(ctx, clientId, processType);
    if (!process) {
      throw new BadRequestException('Processo não iniciado.');
    }

    process.status = ClientLifecycleProcessStatus.Cancelled;
    process.updatedById = ctx.userId || null;
    await this.processRepository.save(process);

    return { success: true };
  }

  async completeLifecycle(
    ctx: RequestContext,
    clientId: string,
    processType: ClientLifecycleProcessType,
    dto: CompleteClientLifecycleDto,
  ) {
    const process = await this.findActiveProcess(ctx, clientId, processType);
    if (!process) {
      throw new BadRequestException('Processo não iniciado.');
    }

    const steps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId: process.id },
    });

    const pendingSteps = steps.filter(
      (step) =>
        step.status !== ClientLifecycleStepStatus.Done &&
        step.status !== ClientLifecycleStepStatus.Skipped,
    );
    if (pendingSteps.length > 0) {
      await this.stepRepository.save(
        pendingSteps.map((step) => ({
          ...step,
          status: ClientLifecycleStepStatus.Done,
          updatedById: ctx.userId || null,
        })),
      );
    }

    process.status = ClientLifecycleProcessStatus.Completed;
    process.completedAt = new Date();
    process.updatedById = ctx.userId || null;
    if (processType === ClientLifecycleProcessType.Offboarding && dto.lostReasonId) {
      process.lostReasonId = dto.lostReasonId;
    }
    await this.processRepository.save(process);

    const client = await this.findClient(ctx, clientId);

    // Reflect the lifecycle outcome on the client status: a completed
    // offboarding ends the relationship, while a completed onboarding promotes
    // a client still flagged as "onboarding" to "active".
    if (processType === ClientLifecycleProcessType.Offboarding) {
      if (client.status !== AgencyClientStatus.Archived) {
        client.status = AgencyClientStatus.Ended;
        await this.clientRepository.save(client);
      }
    } else if (client.status === AgencyClientStatus.Onboarding) {
      client.status = AgencyClientStatus.Active;
      await this.clientRepository.save(client);
    }

    if (processType === ClientLifecycleProcessType.Onboarding) {
      await this.clientNotificationPublisher.publishOnboardingCompleted({ client, actorUserId: ctx.userId });
    } else {
      await this.clientNotificationPublisher.publishOffboardingCompleted({ client, actorUserId: ctx.userId });
    }

    return this.getLifecycle(ctx, clientId, processType);
  }

  async createStep(
    ctx: RequestContext,
    clientId: string,
    processType: ClientLifecycleProcessType,
    dto: CreateClientLifecycleStepDto,
  ) {
    const process = await this.findActiveProcess(ctx, clientId, processType);
    if (!process) {
      throw new BadRequestException('Inicie o processo antes de adicionar etapas.');
    }

    const lastStep = await this.stepRepository.findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId: process.id },
      order: { sortOrder: 'DESC' },
    });

    const intervalValue = dto.intervalValue ?? null;
    const intervalUnit = dto.intervalUnit ?? null;
    const assignment = dto.assignment ?? 'owner';
    const assigneeLabel = this.resolveAssigneeLabel(assignment);
    const dueAt =
      intervalValue != null && intervalUnit
        ? addInterval(process.startedAt ?? new Date(), intervalValue, intervalUnit)
        : null;

    const step = await this.stepRepository.save(
      this.stepRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        processId: process.id,
        clientId,
        sourceConfigOptionId: null,
        stepTypeId: dto.stepTypeId ?? null,
        title: dto.title.trim(),
        description: dto.description ?? null,
        assigneeLabel: dto.assigneeLabel ?? assigneeLabel,
        assigneeMemberId: null,
        intervalValue,
        intervalUnit,
        dueAt,
        status: ClientLifecycleStepStatus.NotStarted,
        notes: dto.notes ?? null,
        sortOrder: (lastStep?.sortOrder ?? -1) + 1,
        createdById: ctx.userId || null,
        updatedById: ctx.userId || null,
        metadata: { customizedForClient: true, assignment },
      }),
    );

    if (process.status === ClientLifecycleProcessStatus.Completed) {
      process.status = ClientLifecycleProcessStatus.InProgress;
      process.completedAt = null;
      process.updatedById = ctx.userId || null;
      await this.processRepository.save(process);
    }

    return step;
  }

  async deleteStep(ctx: RequestContext, clientId: string, stepId: string) {
    const step = await this.stepRepository.findOne({
      where: { id: stepId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, clientId },
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
    clientId: string,
    stepId: string,
    dto: UpdateClientLifecycleStepDto,
  ) {
    const step = await this.stepRepository.findOne({
      where: { id: stepId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, clientId },
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
      const assignment = dto.assignment ?? '';
      step.assigneeLabel = this.resolveAssigneeLabel(assignment);
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

  private async applyConfiguredTasks(
    ctx: RequestContext,
    process: ClientLifecycleProcess,
    processType: ClientLifecycleProcessType,
  ) {
    const configType = STEP_CONFIG_TYPE_BY_PROCESS[processType];
    const configuredSteps = await this.loadConfiguredSteps(ctx, configType);

    const existingSteps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId: process.id },
    });
    const existingSourceIds = new Set(
      existingSteps.map((step) => step.sourceConfigOptionId).filter((id): id is string => Boolean(id)),
    );

    const newSteps = configuredSteps.filter((option) => !existingSourceIds.has(option.id));
    if (newSteps.length === 0) return;

    const maxSortOrder = existingSteps.reduce((max, step) => Math.max(max, step.sortOrder), -1);

    const created = newSteps.map((option, index) =>
      this.buildStepFromConfig(process, option, maxSortOrder + 1 + index),
    );

    await this.stepRepository.save(created);
  }

  private async applyExplicitTemplate(
    ctx: RequestContext,
    process: ClientLifecycleProcess,
    templateConfigOptionId: string,
  ) {
    const template = await this.configOptionRepository.findOne({
      where: { id: templateConfigOptionId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!template) {
      throw new BadRequestException('Modelo não encontrado.');
    }

    const snapshotSteps = Array.isArray((template.metadata as Record<string, unknown>)?.steps)
      ? ((template.metadata as Record<string, unknown>).steps as TemplateStepSnapshot[])
      : [];

    const existingSteps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId: process.id },
    });
    const existingSourceIds = new Set(
      existingSteps.map((step) => step.sourceConfigOptionId).filter((id): id is string => Boolean(id)),
    );

    const maxSortOrder = existingSteps.reduce((max, step) => Math.max(max, step.sortOrder), -1);

    const newSnapshotSteps = snapshotSteps.filter(
      (snapshot) => !snapshot.id || !existingSourceIds.has(snapshot.id),
    );
    if (newSnapshotSteps.length === 0) return;

    const created = newSnapshotSteps.map((snapshot, index) =>
      this.buildStepFromSnapshot(process, snapshot, maxSortOrder + 1 + index),
    );

    await this.stepRepository.save(created);
  }

  private async maybeCompleteProcess(ctx: RequestContext, processId: string) {
    const steps = await this.stepRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, processId },
    });

    if (steps.length === 0) return;

    const allResolved = steps.every(
      (step) =>
        step.status === ClientLifecycleStepStatus.Done ||
        step.status === ClientLifecycleStepStatus.Skipped,
    );

    const process = await this.processRepository.findOne({
      where: { id: processId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!process) return;

    // A conclusão é uma ação explícita e confirmada pela interface. Aqui apenas
    // reabrimos um processo concluído caso uma etapa volte a ficar pendente.
    if (!allResolved && process.status === ClientLifecycleProcessStatus.Completed) {
      process.status = ClientLifecycleProcessStatus.InProgress;
      process.completedAt = null;
      await this.processRepository.save(process);
    }
  }

  private buildStepFromConfig(
    process: ClientLifecycleProcess,
    option: TeamConfigOption,
    sortOrder: number,
  ): ClientLifecycleStep {
    const metadata = (option.metadata ?? {}) as Record<string, unknown>;
    const intervalValue = typeof metadata.intervalValue === 'number' ? metadata.intervalValue : null;
    const intervalUnit =
      metadata.intervalUnit === 'days' || metadata.intervalUnit === 'weeks' || metadata.intervalUnit === 'hours'
        ? (metadata.intervalUnit as ClientLifecycleIntervalUnit)
        : null;

    const baseDate = process.startedAt ?? new Date();
    const dueAt = intervalValue !== null && intervalUnit ? addInterval(baseDate, intervalValue, intervalUnit) : null;

    const assignment = String(metadata.assignment ?? 'owner');

    return this.stepRepository.create({
      tenantId: process.tenantId,
      workspaceId: process.workspaceId,
      processId: process.id,
      clientId: process.clientId,
      sourceConfigOptionId: option.id,
      stepTypeId: typeof metadata.stepTypeId === 'string' ? metadata.stepTypeId : null,
      title: option.name,
      description: typeof metadata.note === 'string' ? metadata.note : null,
      assigneeLabel: this.resolveAssigneeLabel(assignment),
      assigneeMemberId: null,
      intervalValue,
      intervalUnit,
      dueAt,
      status: ClientLifecycleStepStatus.NotStarted,
      sortOrder,
      createdById: process.updatedById,
      updatedById: process.updatedById,
      metadata: { assignment },
    });
  }

  private buildStepFromSnapshot(
    process: ClientLifecycleProcess,
    snapshot: TemplateStepSnapshot,
    sortOrder: number,
  ): ClientLifecycleStep {
    const intervalValue = typeof snapshot.intervalValue === 'number' ? snapshot.intervalValue : null;
    const intervalUnit =
      snapshot.intervalUnit === 'days' || snapshot.intervalUnit === 'weeks' || snapshot.intervalUnit === 'hours'
        ? (snapshot.intervalUnit as ClientLifecycleIntervalUnit)
        : null;

    const baseDate = process.startedAt ?? new Date();
    const dueAt = intervalValue !== null && intervalUnit ? addInterval(baseDate, intervalValue, intervalUnit) : null;

    const assignment = String(snapshot.assignment ?? 'owner');

    return this.stepRepository.create({
      tenantId: process.tenantId,
      workspaceId: process.workspaceId,
      processId: process.id,
      clientId: process.clientId,
      sourceConfigOptionId: snapshot.id ?? null,
      stepTypeId: snapshot.stepTypeId ?? null,
      title: snapshot.name,
      description: snapshot.note ?? null,
      assigneeLabel: this.resolveAssigneeLabel(assignment),
      assigneeMemberId: null,
      intervalValue,
      intervalUnit,
      dueAt,
      status: ClientLifecycleStepStatus.NotStarted,
      sortOrder,
      createdById: process.updatedById,
      updatedById: process.updatedById,
      metadata: { assignment },
    });
  }

  private resolveAssigneeLabel(assignment: string): string | null {
    const knownLabels: Record<string, string> = {
      owner: 'Responsável pela conta',
      admin: 'Administrador',
      account_manager: 'Account Manager',
      ops: 'Operações',
      finance: 'Financeiro',
      director: 'Diretor',
      client: 'Cliente',
    };
    return knownLabels[assignment] ?? (assignment || null);
  }

  private async loadConfiguredSteps(
    ctx: RequestContext,
    configType: 'client_onboarding_task' | 'client_offboarding_task',
  ): Promise<TeamConfigOption[]> {
    const all = await this.configOptionRepository.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type: configType, status: 'active' },
    });

    return all.sort((a, b) => {
      const orderA = Number((a.metadata as Record<string, unknown> | null)?.order ?? 0);
      const orderB = Number((b.metadata as Record<string, unknown> | null)?.order ?? 0);
      return orderA - orderB;
    });
  }

  private async hasConfiguredSteps(
    ctx: RequestContext,
    processType: ClientLifecycleProcessType,
  ): Promise<boolean> {
    const configType = STEP_CONFIG_TYPE_BY_PROCESS[processType];
    const steps = await this.loadConfiguredSteps(ctx, configType);
    return steps.length > 0;
  }

  private async countActivitiesByStep(ctx: RequestContext, stepIds: string[]): Promise<Map<string, number>> {
    if (stepIds.length === 0) return new Map();

    const links = await this.activityLinkRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        entityType: ActivityEntityType.ClientLifecycleStep,
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
    clientId: string,
    processType: ClientLifecycleProcessType,
  ) {
    return this.processRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        clientId,
        processType,
        status: In([ClientLifecycleProcessStatus.InProgress, ClientLifecycleProcessStatus.Completed]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async findClient(ctx: RequestContext, id: string) {
    const client = await this.clientRepository.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!client) {
      throw new BadRequestException('Cliente não encontrado.');
    }

    return client;
  }
}
