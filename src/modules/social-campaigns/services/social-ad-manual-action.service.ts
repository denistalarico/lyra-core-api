import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
} from '../../social-integrations';
import type {
  SocialAdActionPreflightDto,
  UpdateSocialAdActionPolicyDto,
} from '../dto';
import {
  SocialAdActionPolicyEntity,
  SocialAdGovernedActionEntity,
  type SocialAdManualActionType,
} from '../entities';
import {
  MetaAdManualActionError,
  MetaAdsManualActionAdapter,
  type MetaAdWritableState,
} from './meta-ads-manual-action.adapter';
import { SocialAdActionsConfigService } from './social-ad-actions-config.service';
import type { SocialCampaignsScope } from './social-boost-template.service';

const PROVIDER = 'meta_ads';

@Injectable()
export class SocialAdManualActionService {
  constructor(
    @InjectRepository(SocialAdActionPolicyEntity, 'agency')
    private readonly policies: Repository<SocialAdActionPolicyEntity>,
    @InjectRepository(SocialAdGovernedActionEntity, 'agency')
    private readonly actions: Repository<SocialAdGovernedActionEntity>,
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connections: Repository<SocialAdAccountConnectionEntity>,
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entities: Repository<SocialAdEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: SocialAdActionsConfigService,
    private readonly meta: MetaAdsManualActionAdapter,
  ) {}

  availability() {
    return {
      available: this.config.writesEnabled,
      mode: 'manual_only' as const,
      requiresPreflight: true,
      recommendationsCanExecute: false,
    };
  }

  async getPolicy(scope: SocialCampaignsScope, connectionId: string) {
    await this.requireConnection(scope, connectionId);
    const row = await this.findPolicy(scope, connectionId);
    return this.policyView(row, connectionId);
  }

  async updatePolicy(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    dto: UpdateSocialAdActionPolicyDto,
  ) {
    await this.requireConnection(scope, dto.connectionId);
    let row = await this.findPolicy(scope, dto.connectionId);
    if (!row) {
      row = this.policies.create({
        ...scope,
        connectionId: dto.connectionId,
        createdById: actorUserId,
      });
    }
    row.enabled = dto.enabled;
    row.allowStatus = dto.allowStatus;
    row.allowBudget = dto.allowBudget;
    row.allowSchedule = dto.allowSchedule;
    row.allowDelete = dto.allowDelete;
    row.maxBudgetMinor =
      dto.maxBudgetMinor === null || dto.maxBudgetMinor === undefined
        ? null
        : String(dto.maxBudgetMinor);
    row.maxBudgetIncreasePercent = dto.maxBudgetIncreasePercent;
    row.confirmationTtlMinutes = dto.confirmationTtlMinutes;
    row.updatedById = actorUserId;
    return this.policyView(await this.policies.save(row), dto.connectionId);
  }

  async history(scope: SocialCampaignsScope, connectionId: string, limit = 20) {
    await this.requireConnection(scope, connectionId);
    const items = await this.actions.find({
      where: { ...this.scopeWhere(scope), connectionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return {
      items: items.map((row) => this.actionView(row)),
      total: items.length,
    };
  }

  async preflight(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    actionType: SocialAdManualActionType,
    dto: SocialAdActionPreflightDto,
  ) {
    const existing = await this.actions.findOne({
      where: { requestId: dto.requestId },
    });
    if (existing) {
      this.assertActionScope(existing, scope);
      if (existing.actionType !== actionType)
        throw new ConflictException('Request already used.');
      return this.actionView(existing);
    }

    this.assertGlobalEnabled();
    await this.requireConnection(scope, dto.connectionId);
    const policy = await this.requireEnabledPolicy(
      scope,
      dto.connectionId,
      actionType,
    );
    const entity = await this.requireEntity(scope, dto);
    const change = this.validateChange(actionType, dto, entity, policy);
    const confirmationPhrase =
      actionType === 'delete'
        ? `EXCLUIR ${String(entity.name || entity.externalId)
            .trim()
            .slice(0, 220)}`
        : null;
    const expiresAt = new Date(
      Date.now() + policy.confirmationTtlMinutes * 60_000,
    );

    const row = this.actions.create({
      ...scope,
      connectionId: dto.connectionId,
      entityLevel: dto.entityLevel,
      entityExternalId: dto.entityExternalId,
      entityName: entity.name,
      actionType,
      status: 'pending_confirmation',
      requestId: dto.requestId,
      confirmationRequestId: null,
      beforeSnapshot: this.snapshot(entity),
      requestedChange: change,
      providerResult: null,
      confirmationPhrase,
      expiresAt,
      proposedById: actorUserId,
      confirmedById: null,
      errorCode: null,
      executedAt: null,
      verifiedAt: null,
    });
    return this.actionView(await this.actions.save(row));
  }

  async confirm(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    actionType: SocialAdManualActionType,
    actionId: string,
    confirmationRequestId: string,
    confirmationText?: string,
  ) {
    const claimed = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SocialAdGovernedActionEntity);
      const row = await repository
        .createQueryBuilder('action')
        .setLock('pessimistic_write')
        .where('action.id = :actionId', { actionId })
        .getOne();
      if (!row) throw new NotFoundException('Manual action not found.');
      this.assertActionScope(row, scope);
      if (row.actionType !== actionType)
        throw new BadRequestException('Action type mismatch.');
      if (row.confirmationRequestId === confirmationRequestId) return row;
      if (row.confirmationRequestId)
        throw new ConflictException('Action already confirmed.');
      if (row.status !== 'pending_confirmation')
        throw new ConflictException('Action cannot be confirmed.');
      if (row.expiresAt.getTime() <= Date.now()) {
        row.status = 'expired';
        await repository.save(row);
        throw new ConflictException('Action confirmation expired.');
      }
      if (
        row.confirmationPhrase &&
        confirmationText !== row.confirmationPhrase
      ) {
        throw new BadRequestException('Confirmation phrase does not match.');
      }

      this.assertGlobalEnabled();
      await this.requireEnabledPolicy(scope, row.connectionId, row.actionType);
      await this.requireEntity(scope, {
        connectionId: row.connectionId,
        entityLevel: row.entityLevel,
        entityExternalId: row.entityExternalId,
      });
      row.status = 'executing';
      row.confirmationRequestId = confirmationRequestId;
      row.confirmedById = actorUserId;
      return repository.save(row);
    });

    if (claimed.status !== 'executing') return this.actionView(claimed);

    try {
      const result = await this.meta.execute({
        ...scope,
        connectionId: claimed.connectionId,
        entityLevel: claimed.entityLevel,
        entityExternalId: claimed.entityExternalId,
        actionType: claimed.actionType,
        expected: claimed.beforeSnapshot as MetaAdWritableState,
        change: claimed.requestedChange,
      });
      claimed.providerResult = result;
      claimed.executedAt = new Date();
      claimed.verifiedAt = result.verified ? new Date() : null;
      if (!result.providerAccepted) {
        claimed.status = 'failed';
        claimed.errorCode = 'provider_not_confirmed';
      } else {
        claimed.status = result.verified ? 'verified' : 'succeeded_unverified';
      }
    } catch (error) {
      claimed.status =
        error instanceof MetaAdManualActionError ? 'blocked' : 'failed';
      claimed.errorCode =
        error instanceof MetaAdManualActionError
          ? error.code
          : 'provider_write_failed';
      claimed.providerResult = null;
    }

    // Deliberately does not mutate SocialAdEntity. The next provider sync owns
    // the local read model and preserves history after destructive actions.
    return this.actionView(await this.actions.save(claimed));
  }

  private validateChange(
    actionType: SocialAdManualActionType,
    dto: SocialAdActionPreflightDto,
    entity: SocialAdEntity,
    policy: SocialAdActionPolicyEntity,
  ): Record<string, unknown> {
    if (actionType === 'set_status') {
      if (
        !dto.status ||
        dto.budgetKind ||
        dto.budgetAmountMinor ||
        dto.endsAt
      ) {
        throw new BadRequestException(
          'Only status is accepted for this action.',
        );
      }
      if (entity.archivedAt)
        throw new BadRequestException('Archived objects cannot be changed.');
      return { status: dto.status };
    }
    if (actionType === 'set_budget') {
      if (
        !dto.budgetKind ||
        dto.budgetAmountMinor === undefined ||
        dto.status ||
        dto.endsAt ||
        entity.entityLevel === 'ad'
      ) {
        throw new BadRequestException(
          'A campaign or ad set budget is required.',
        );
      }
      const current =
        dto.budgetKind === 'daily'
          ? entity.dailyBudgetMinor
          : entity.lifetimeBudgetMinor;
      const other =
        dto.budgetKind === 'daily'
          ? entity.lifetimeBudgetMinor
          : entity.dailyBudgetMinor;
      if (current === null || other !== null) {
        throw new BadRequestException('Budget type cannot be changed here.');
      }
      const next = BigInt(dto.budgetAmountMinor);
      if (policy.maxBudgetMinor && next > BigInt(policy.maxBudgetMinor)) {
        throw new ForbiddenException('Budget exceeds the account policy.');
      }
      const currentValue = BigInt(current);
      const maxIncrease =
        currentValue +
        (currentValue * BigInt(policy.maxBudgetIncreasePercent)) / 100n;
      if (next > maxIncrease)
        throw new ForbiddenException(
          'Budget increase exceeds the account policy.',
        );
      return {
        budgetKind: dto.budgetKind,
        budgetAmountMinor: dto.budgetAmountMinor,
      };
    }
    if (actionType === 'set_end_time') {
      if (
        !dto.endsAt ||
        dto.status ||
        dto.budgetKind ||
        dto.budgetAmountMinor ||
        entity.entityLevel === 'ad'
      ) {
        throw new BadRequestException(
          'A campaign or ad set end date is required.',
        );
      }
      const endsAt = new Date(dto.endsAt);
      if (endsAt.getTime() < Date.now() + 15 * 60_000) {
        throw new BadRequestException(
          'End date must be at least 15 minutes ahead.',
        );
      }
      return { endsAt: endsAt.toISOString() };
    }
    if (dto.status || dto.budgetKind || dto.budgetAmountMinor || dto.endsAt) {
      throw new BadRequestException('Delete does not accept another change.');
    }
    return { irreversible: true };
  }

  private snapshot(entity: SocialAdEntity): MetaAdWritableState {
    return {
      status: entity.status?.toUpperCase() ?? null,
      dailyBudgetMinor: entity.dailyBudgetMinor,
      lifetimeBudgetMinor: entity.lifetimeBudgetMinor,
      endsAt: entity.stopTime?.toISOString() ?? null,
    };
  }

  private async requireEnabledPolicy(
    scope: SocialCampaignsScope,
    connectionId: string,
    actionType: SocialAdManualActionType,
  ) {
    const row = await this.findPolicy(scope, connectionId);
    const allowed =
      row?.enabled &&
      ((actionType === 'set_status' && row.allowStatus) ||
        (actionType === 'set_budget' && row.allowBudget) ||
        (actionType === 'set_end_time' && row.allowSchedule) ||
        (actionType === 'delete' && row.allowDelete));
    if (!row || !allowed)
      throw new ForbiddenException(
        'Manual action is disabled by account policy.',
      );
    return row;
  }

  private async requireConnection(
    scope: SocialCampaignsScope,
    connectionId: string,
  ) {
    const row = await this.connections.findOne({
      where: {
        id: connectionId,
        ...this.scopeWhere(scope),
        provider: PROVIDER,
      },
    });
    if (!row) throw new NotFoundException('Meta connection not found.');
    return row;
  }

  private async requireEntity(
    scope: SocialCampaignsScope,
    input: {
      connectionId: string;
      entityLevel: 'campaign' | 'adset' | 'ad';
      entityExternalId: string;
    },
  ) {
    const row = await this.entities.findOne({
      where: {
        ...this.scopeWhere(scope),
        connectionId: input.connectionId,
        provider: PROVIDER,
        entityLevel: input.entityLevel,
        externalId: input.entityExternalId,
      },
    });
    if (!row) throw new NotFoundException('Meta object not found.');
    return row;
  }

  private findPolicy(scope: SocialCampaignsScope, connectionId: string) {
    return this.policies.findOne({
      where: { ...this.scopeWhere(scope), connectionId },
    });
  }

  private scopeWhere(scope: SocialCampaignsScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private assertGlobalEnabled() {
    if (!this.config.writesEnabled)
      throw new ForbiddenException('Meta writes are disabled.');
  }

  private assertActionScope(
    row: SocialAdGovernedActionEntity,
    scope: SocialCampaignsScope,
  ) {
    if (
      row.tenantId !== scope.tenantId ||
      row.workspaceId !== scope.workspaceId ||
      row.agencyClientId !== scope.agencyClientId
    ) {
      throw new NotFoundException('Manual action not found.');
    }
  }

  private policyView(
    row: SocialAdActionPolicyEntity | null,
    connectionId: string,
  ) {
    return {
      connectionId,
      globalWritesEnabled: this.config.writesEnabled,
      mode: 'manual_only' as const,
      enabled: row?.enabled ?? false,
      allowStatus: row?.allowStatus ?? true,
      allowBudget: row?.allowBudget ?? false,
      allowSchedule: row?.allowSchedule ?? false,
      allowDelete: row?.allowDelete ?? false,
      maxBudgetMinor: row?.maxBudgetMinor ?? null,
      maxBudgetIncreasePercent: row?.maxBudgetIncreasePercent ?? 25,
      confirmationTtlMinutes: row?.confirmationTtlMinutes ?? 10,
    };
  }

  private actionView(row: SocialAdGovernedActionEntity) {
    return {
      id: row.id,
      connectionId: row.connectionId,
      entityLevel: row.entityLevel,
      entityExternalId: row.entityExternalId,
      entityName: row.entityName,
      actionType: row.actionType,
      status: row.status,
      before: row.beforeSnapshot,
      requestedChange: row.requestedChange,
      providerResult: row.providerResult,
      confirmationPhrase: row.confirmationPhrase,
      expiresAt: row.expiresAt.toISOString(),
      errorCode: row.errorCode,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      executedAt: row.executedAt?.toISOString() ?? null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      readModelReconcilesOnNextSync: true,
    };
  }
}
