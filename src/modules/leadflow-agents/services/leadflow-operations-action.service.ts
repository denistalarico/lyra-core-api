import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type {
  ConfirmLeadFlowOperationsActionDto,
  CreateLeadFlowOperationsActionDto,
  LeadFlowOperationsActionListResponse,
  LeadFlowOperationsActionResponse,
} from '../dto';
import {
  LeadFlowOperationsActionEntity,
  LeadFlowOperationsActionEventEntity,
  type LeadFlowOperationsActionEventType,
  type LeadFlowOperationsActionIntent,
} from '../entities';

const AGENCY_CONNECTION = 'agency';
const EXECUTABLE_INTENTS = new Set<LeadFlowOperationsActionIntent>([
  'capacity_unavailable',
  'capacity_released',
  'add_closure',
]);

type NormalizedAction = {
  timezone: string | null;
  resourceKey: string | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  validationIssues: string[];
  preview: Record<string, unknown>;
};

@Injectable()
export class LeadFlowOperationsActionService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(LeadFlowClientSettingsEntity, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<LeadFlowClientSettingsEntity>,
    @InjectRepository(LeadFlowOperationsActionEntity, AGENCY_CONNECTION)
    private readonly actionsRepository: Repository<LeadFlowOperationsActionEntity>,
  ) {}

  async list(
    ctx: RequestContext,
  ): Promise<LeadFlowOperationsActionListResponse> {
    const active = await this.resolveActiveSettings(ctx);
    const items = await this.actionsRepository.find({
      where: this.scope(ctx, active.id),
      order: { createdAt: 'DESC' },
      take: 30,
    });
    return { items: items.map((item) => this.mapResponse(item)) };
  }

  async propose(
    ctx: RequestContext,
    dto: CreateLeadFlowOperationsActionDto,
  ): Promise<LeadFlowOperationsActionResponse> {
    const active = await this.resolveActiveSettings(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);
    const idempotencyKey = dto.idempotencyKey?.trim() || null;

    if (idempotencyKey) {
      const existing = await this.actionsRepository.findOne({
        where: {
          ...this.scope(ctx, active.id),
          idempotencyKey,
        },
      });
      if (existing) return this.mapResponse(existing);
    }

    const normalized = this.normalize(dto.intent, dto.payload);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(LeadFlowOperationsActionEntity);
      const action = await repository.save(
        repository.create({
          tenantId: ctx.tenantId,
          workspaceId,
          settingsId: active.id,
          businessModeKey: String(active.businessModeKey),
          intent: dto.intent,
          status: 'pending_confirmation',
          requestText: dto.requestText.trim(),
          payload: dto.payload,
          preview: normalized.preview,
          resourceKey: normalized.resourceKey,
          timezone: normalized.timezone,
          effectiveFrom: normalized.effectiveFrom,
          effectiveUntil: normalized.effectiveUntil,
          validationIssues: normalized.validationIssues,
          idempotencyKey,
          revision: 1,
          createdById: ctx.userId ?? null,
          confirmedById: null,
          confirmedAt: null,
          cancelledById: null,
          cancelledAt: null,
        }),
      );
      await this.appendEvent(manager, action, 'proposed', ctx.userId ?? null);
      return this.mapResponse(action);
    });
  }

  async confirm(
    ctx: RequestContext,
    actionId: string,
    dto: ConfirmLeadFlowOperationsActionDto,
  ): Promise<LeadFlowOperationsActionResponse> {
    const active = await this.resolveActiveSettings(ctx);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(LeadFlowOperationsActionEntity);
      const action = await repository.findOne({
        where: { id: actionId, ...this.scope(ctx, active.id) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!action) throw new NotFoundException('Proposta não encontrada.');
      if (action.status === 'confirmed') return this.mapResponse(action);
      if (action.status !== 'pending_confirmation') {
        throw new ConflictException('Esta proposta não está mais pendente.');
      }
      if (action.revision !== dto.expectedRevision) {
        throw new ConflictException(
          'A proposta mudou. Revise os dados antes de confirmar.',
        );
      }
      if (action.validationIssues.length > 0) {
        throw new BadRequestException({
          message: 'A proposta ainda possui dados pendentes.',
          validationIssues: action.validationIssues,
        });
      }

      action.status = 'confirmed';
      action.confirmedAt = new Date();
      action.confirmedById = ctx.userId ?? null;
      action.revision += 1;
      const saved = await repository.save(action);
      await this.appendEvent(manager, saved, 'confirmed', ctx.userId ?? null);
      return this.mapResponse(saved);
    });
  }

  async cancel(
    ctx: RequestContext,
    actionId: string,
    dto: ConfirmLeadFlowOperationsActionDto,
  ): Promise<LeadFlowOperationsActionResponse> {
    const active = await this.resolveActiveSettings(ctx);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(LeadFlowOperationsActionEntity);
      const action = await repository.findOne({
        where: { id: actionId, ...this.scope(ctx, active.id) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!action) throw new NotFoundException('Proposta não encontrada.');
      if (action.status === 'cancelled') return this.mapResponse(action);
      if (action.status !== 'pending_confirmation') {
        throw new ConflictException(
          'Somente propostas pendentes podem ser canceladas.',
        );
      }
      if (action.revision !== dto.expectedRevision) {
        throw new ConflictException(
          'A proposta mudou. Atualize os dados antes de cancelar.',
        );
      }

      action.status = 'cancelled';
      action.cancelledAt = new Date();
      action.cancelledById = ctx.userId ?? null;
      action.revision += 1;
      const saved = await repository.save(action);
      await this.appendEvent(manager, saved, 'cancelled', ctx.userId ?? null);
      return this.mapResponse(saved);
    });
  }

  private normalize(
    intent: LeadFlowOperationsActionIntent,
    payload: Record<string, unknown>,
  ): NormalizedAction {
    const issues: string[] = [];
    const timezone = this.readString(payload.timezone);
    const resourceKey = this.readString(payload.resourceRef);
    const period = this.readRecord(payload.effectivePeriod);
    const effectiveFrom = this.readDate(period?.startsAt);
    const effectiveUntil = this.readDate(period?.endsAt);

    if (!timezone || !this.isValidTimezone(timezone)) {
      issues.push('Informe um fuso horário IANA válido.');
    }
    if (!EXECUTABLE_INTENTS.has(intent)) {
      issues.push(
        'A fonte canônica desta alteração ainda não está conectada ao chat.',
      );
    }
    if (
      (intent === 'capacity_unavailable' || intent === 'capacity_released') &&
      !resourceKey
    ) {
      issues.push('Identifique o recurso, vaga, item ou capacidade afetada.');
    }
    if (!effectiveFrom) {
      issues.push('Informe quando a alteração começa.');
    }
    if (intent === 'add_closure' && !effectiveUntil) {
      issues.push('Informe quando o fechamento termina.');
    }
    if (
      effectiveFrom &&
      effectiveUntil &&
      effectiveUntil.getTime() <= effectiveFrom.getTime()
    ) {
      issues.push('O término precisa ser posterior ao início.');
    }

    return {
      timezone,
      resourceKey,
      effectiveFrom,
      effectiveUntil,
      validationIssues: [...new Set(issues)],
      preview: {
        title: this.actionTitle(intent),
        summary: this.actionSummary(
          intent,
          payload,
          effectiveFrom,
          effectiveUntil,
        ),
        requiresExplicitConfirmation: true,
        runtimeEffect:
          EXECUTABLE_INTENTS.has(intent) && issues.length === 0
            ? 'canonical_operational_rule'
            : 'proposal_only',
      },
    };
  }

  private actionSummary(
    intent: LeadFlowOperationsActionIntent,
    payload: Record<string, unknown>,
    effectiveFrom: Date | null,
    effectiveUntil: Date | null,
  ) {
    const label =
      this.readString(payload.resourceLabel) ??
      this.readString(payload.resourceRef) ??
      'operação';
    const period = effectiveFrom
      ? effectiveUntil
        ? `${effectiveFrom.toISOString()} — ${effectiveUntil.toISOString()}`
        : `a partir de ${effectiveFrom.toISOString()}`
      : 'período ainda não resolvido';
    return `${this.actionTitle(intent)}: ${label}, ${period}.`;
  }

  private actionTitle(intent: LeadFlowOperationsActionIntent) {
    const titles: Record<LeadFlowOperationsActionIntent, string> = {
      update_offer_price: 'Alterar preço',
      schedule_discount: 'Programar desconto',
      add_closure: 'Registrar fechamento',
      update_business_hours: 'Alterar horário',
      capacity_unavailable: 'Registrar indisponibilidade',
      capacity_released: 'Liberar capacidade',
    };
    return titles[intent];
  }

  private async resolveActiveSettings(ctx: RequestContext) {
    const workspaceId = this.requireWorkspaceId(ctx);
    const managedClientId =
      ctx.managedContext?.operatingMode === 'client' &&
      ctx.managedContext.clientId
        ? ctx.managedContext.clientId
        : null;
    const settings = await this.settingsRepository.findOne({
      where: managedClientId
        ? {
            tenantId: ctx.tenantId,
            workspaceId,
            contextType: LeadFlowSettingsContextType.Client,
            agencyClientId: managedClientId,
          }
        : {
            tenantId: ctx.tenantId,
            workspaceId,
            contextType: LeadFlowSettingsContextType.Agency,
            agencyClientId: IsNull(),
          },
    });
    if (!settings) {
      throw new NotFoundException(
        'Configure o LeadFlow Settings deste contexto antes de usar o chat.',
      );
    }
    return settings;
  }

  private appendEvent(
    manager: EntityManager,
    action: LeadFlowOperationsActionEntity,
    eventType: LeadFlowOperationsActionEventType,
    actorId: string | null,
  ) {
    const repository = manager.getRepository(
      LeadFlowOperationsActionEventEntity,
    );
    return repository.save(
      repository.create({
        actionId: action.id,
        tenantId: action.tenantId,
        workspaceId: action.workspaceId,
        eventType,
        actorId,
        snapshot: {
          status: action.status,
          intent: action.intent,
          revision: action.revision,
          settingsId: action.settingsId,
          businessModeKey: action.businessModeKey,
          resourceKey: action.resourceKey,
          effectiveFrom: action.effectiveFrom?.toISOString() ?? null,
          effectiveUntil: action.effectiveUntil?.toISOString() ?? null,
        },
      }),
    );
  }

  private mapResponse(
    action: LeadFlowOperationsActionEntity,
  ): LeadFlowOperationsActionResponse {
    return {
      id: action.id,
      businessModeKey: action.businessModeKey,
      intent: action.intent,
      status: action.status,
      requestText: action.requestText,
      payload: action.payload,
      preview: action.preview,
      validationIssues: action.validationIssues,
      canConfirm:
        action.status === 'pending_confirmation' &&
        action.validationIssues.length === 0,
      revision: action.revision,
      effectiveFrom: action.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: action.effectiveUntil?.toISOString() ?? null,
      timezone: action.timezone,
      createdAt: action.createdAt.toISOString(),
      confirmedAt: action.confirmedAt?.toISOString() ?? null,
      cancelledAt: action.cancelledAt?.toISOString() ?? null,
    };
  }

  private scope(ctx: RequestContext, settingsId: string) {
    return {
      tenantId: ctx.tenantId,
      workspaceId: this.requireWorkspaceId(ctx),
      settingsId,
    };
  }

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }

  private readRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private readDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isValidTimezone(value: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }
}
