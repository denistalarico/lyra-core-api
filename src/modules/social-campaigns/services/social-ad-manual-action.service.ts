import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
} from '../../social-integrations';
import { GoogleAdsMutationError } from '../../social-integrations/services/google-ads-mutation.client';
import { mapSocialAdSyncError } from '../../social-integrations/sync/social-ad-sync.http-error';
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
  GoogleAdManualActionError,
  GoogleAdsManualActionAdapter,
  normalizeGoogleKeywordText,
  type GoogleAdTarget,
  type GoogleAdWritableState,
} from './google-ads-manual-action.adapter';
import {
  MetaAdManualActionError,
  MetaAdsManualActionAdapter,
  type MetaAdWritableState,
} from './meta-ads-manual-action.adapter';
import {
  SocialAdActionsConfigService,
  type SocialAdManualActionProvider,
} from './social-ad-actions-config.service';
import type { SocialCampaignsScope } from './social-boost-template.service';

/**
 * The provider comes from the route and must match the connection (D-G5): a
 * Meta route never reaches a Google connection, nor the other way round. Each
 * provider has its own global brake and its own adapter.
 */
const META_PROVIDER: SocialAdManualActionProvider = 'meta_ads';
const META_ACTION_TYPES = new Set<SocialAdManualActionType>([
  'set_status',
  'set_budget',
  'set_end_time',
  'delete',
]);
/** GA-WRITE (D-G5): schedule and delete stay out for Google. */
const GOOGLE_ACTION_TYPES = new Set<SocialAdManualActionType>([
  'set_status',
  'set_budget',
  'negative_keyword',
  'keyword',
  'search_theme',
]);
const KEYWORD_ACTION_TYPES = new Set<SocialAdManualActionType>([
  'negative_keyword',
  'keyword',
  'search_theme',
]);
const PROVIDER_LABEL: Record<SocialAdManualActionProvider, string> = {
  meta_ads: 'Meta',
  google_ads: 'Google Ads',
};

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
    private readonly google: GoogleAdsManualActionAdapter,
  ) {}

  availability(provider: SocialAdManualActionProvider = META_PROVIDER) {
    return {
      available: this.config.writesEnabledFor(provider),
      mode: 'manual_only' as const,
      requiresPreflight: true,
      recommendationsCanExecute: false,
    };
  }

  async getPolicy(
    scope: SocialCampaignsScope,
    connectionId: string,
    provider: SocialAdManualActionProvider = META_PROVIDER,
  ) {
    await this.requireConnection(scope, connectionId, provider);
    const row = await this.findPolicy(scope, connectionId);
    return this.policyView(row, connectionId, provider);
  }

  async updatePolicy(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    dto: UpdateSocialAdActionPolicyDto,
    provider: SocialAdManualActionProvider = META_PROVIDER,
  ) {
    await this.requireConnection(scope, dto.connectionId, provider);
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
    row.allowBoost = dto.allowBoost;
    row.maxBudgetMinor =
      dto.maxBudgetMinor === null || dto.maxBudgetMinor === undefined
        ? null
        : String(dto.maxBudgetMinor);
    row.maxBudgetIncreasePercent = dto.maxBudgetIncreasePercent;
    row.confirmationTtlMinutes = dto.confirmationTtlMinutes;
    if (provider === 'google_ads') {
      // D-G5: no schedule, delete or boost on Google, whatever the body says.
      row.allowSchedule = false;
      row.allowDelete = false;
      row.allowBoost = false;
      if (dto.allowKeywords !== undefined)
        row.allowKeywords = dto.allowKeywords;
    } else {
      row.allowKeywords = false;
    }
    row.updatedById = actorUserId;
    return this.policyView(
      await this.policies.save(row),
      dto.connectionId,
      provider,
    );
  }

  async history(
    scope: SocialCampaignsScope,
    connectionId: string,
    limit = 20,
    provider: SocialAdManualActionProvider = META_PROVIDER,
  ) {
    await this.requireConnection(scope, connectionId, provider);
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
    provider: SocialAdManualActionProvider = META_PROVIDER,
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

    this.assertActionType(provider, actionType);
    this.assertGlobalEnabled(provider);
    await this.requireConnection(scope, dto.connectionId, provider);
    const policy = await this.requireEnabledPolicy(
      scope,
      dto.connectionId,
      actionType,
      provider,
    );
    const entity = await this.requireEntity(scope, dto, provider);
    let change: Record<string, unknown>;
    let before: Record<string, unknown>;
    if (provider === 'google_ads') {
      ({ change, before } = await this.prepareGoogle(
        scope,
        actionType,
        dto,
        entity,
        policy,
      ));
    } else {
      change = this.validateChange(actionType, dto, entity, policy);
      before = this.snapshot(entity);
    }
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
      beforeSnapshot: before,
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
    provider: SocialAdManualActionProvider = META_PROVIDER,
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

      this.assertActionType(provider, row.actionType);
      this.assertGlobalEnabled(provider);
      // The action must belong to a connection of the route's provider.
      await this.requireConnection(scope, row.connectionId, provider);
      await this.requireEnabledPolicy(
        scope,
        row.connectionId,
        row.actionType,
        provider,
      );
      await this.requireEntity(
        scope,
        {
          connectionId: row.connectionId,
          entityLevel: row.entityLevel,
          entityExternalId: row.entityExternalId,
        },
        provider,
      );
      row.status = 'executing';
      row.confirmationRequestId = confirmationRequestId;
      row.confirmedById = actorUserId;
      return repository.save(row);
    });

    if (claimed.status !== 'executing') return this.actionView(claimed);

    try {
      const result =
        provider === 'google_ads'
          ? await this.google.execute({
              ...scope,
              connectionId: claimed.connectionId,
              actionType: claimed.actionType,
              target: claimed.requestedChange.target as GoogleAdTarget,
              change: claimed.requestedChange,
              expected: claimed.beforeSnapshot as GoogleAdWritableState,
            })
          : await this.meta.execute({
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
      const blocked =
        error instanceof MetaAdManualActionError ||
        error instanceof GoogleAdManualActionError
          ? error
          : null;
      claimed.status = blocked ? 'blocked' : 'failed';
      claimed.errorCode = blocked
        ? blocked.code
        : error instanceof GoogleAdsMutationError
          ? // Google's enum is an identifier, never request data.
            `${error.code}${error.reason ? `:${error.reason}` : ''}`.slice(
              0,
              120,
            )
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
    if (dto.payload) {
      throw new BadRequestException(
        'Keyword changes are not available for this action.',
      );
    }
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
      this.assertBudgetPolicy(current, BigInt(dto.budgetAmountMinor), policy);
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

  /** Same limits for every provider (D-G5). */
  private assertBudgetPolicy(
    current: string,
    next: bigint,
    policy: SocialAdActionPolicyEntity,
  ) {
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
  }

  /**
   * GA-WRITE preflight: shape and level from the mirror, then live state from
   * Google (one operation), then policy limits against that live state, then
   * the same mutation with `validateOnly` (one operation). Nothing is applied.
   */
  private async prepareGoogle(
    scope: SocialCampaignsScope,
    actionType: SocialAdManualActionType,
    dto: SocialAdActionPreflightDto,
    entity: SocialAdEntity,
    policy: SocialAdActionPolicyEntity,
  ) {
    const target = this.googleTarget(entity);
    const change = await this.validateGoogleChange(
      scope,
      actionType,
      dto,
      entity,
      target,
    );
    const input = {
      ...scope,
      connectionId: dto.connectionId,
      actionType,
      target,
      change,
    };
    const before = await this.callGoogle(() => this.google.inspect(input));
    this.assertGoogleState(actionType, change, before, policy);
    await this.callGoogle(() =>
      this.google.validate({ ...input, expected: before }),
    );
    return { change, before: before as unknown as Record<string, unknown> };
  }

  private googleTarget(entity: SocialAdEntity): GoogleAdTarget {
    if (entity.entityLevel === 'campaign') {
      return { kind: 'campaign', id: entity.externalId, adGroupId: null };
    }
    if (entity.entityLevel === 'adset') {
      // D-G1: asset groups live at `adset` with `googleKind`; absent = ad group.
      return {
        kind:
          entity.metadata?.googleKind === 'asset_group'
            ? 'asset_group'
            : 'ad_group',
        id: entity.externalId,
        adGroupId: null,
      };
    }
    return {
      kind: 'ad_group_ad',
      id: entity.externalId,
      adGroupId: entity.parentExternalId,
    };
  }

  private async validateGoogleChange(
    scope: SocialCampaignsScope,
    actionType: SocialAdManualActionType,
    dto: SocialAdActionPreflightDto,
    entity: SocialAdEntity,
    target: GoogleAdTarget,
  ): Promise<Record<string, unknown>> {
    if (entity.archivedAt)
      throw new BadRequestException('Archived objects cannot be changed.');
    if (dto.endsAt)
      throw new BadRequestException('End dates cannot be changed on Google.');

    if (actionType === 'set_status') {
      if (!dto.status || dto.budgetKind || dto.budgetAmountMinor || dto.payload)
        throw new BadRequestException(
          'Only status is accepted for this action.',
        );
      return { status: dto.status, target };
    }

    if (actionType === 'set_budget') {
      if (
        dto.budgetKind !== 'daily' ||
        dto.budgetAmountMinor === undefined ||
        dto.status ||
        dto.payload ||
        entity.entityLevel !== 'campaign'
      ) {
        throw new BadRequestException('A daily campaign budget is required.');
      }
      return {
        budgetKind: 'daily',
        budgetAmountMinor: dto.budgetAmountMinor,
        target,
      };
    }

    const payload = dto.payload;
    if (!payload || dto.status || dto.budgetKind || dto.budgetAmountMinor)
      throw new BadRequestException('A keyword payload is required.');
    const text = normalizeGoogleKeywordText(payload.text);
    if (!text) throw new BadRequestException('Keyword text is required.');

    if (actionType === 'search_theme') {
      if (target.kind !== 'asset_group')
        throw new BadRequestException(
          'Search themes belong to a Performance Max asset group.',
        );
      if (payload.matchType)
        throw new BadRequestException('Search themes have no match type.');
      return { op: payload.op, text, matchType: null, target };
    }

    if (!payload.matchType)
      throw new BadRequestException('A match type is required.');
    if (text.split(' ').length > 10)
      throw new BadRequestException('A keyword has at most 10 words.');

    if (actionType === 'negative_keyword' && target.kind !== 'campaign')
      throw new BadRequestException('Negative keywords belong to a campaign.');
    if (actionType === 'keyword') {
      if (target.kind !== 'ad_group')
        throw new BadRequestException('Keywords belong to an ad group.');
      const campaign = await this.entities.findOne({
        where: {
          ...this.scopeWhere(scope),
          connectionId: entity.connectionId,
          provider: 'google_ads',
          entityLevel: 'campaign',
          externalId:
            entity.campaignExternalId ?? entity.parentExternalId ?? '',
        },
      });
      if (campaign?.metadata?.channelType !== 'SEARCH')
        throw new BadRequestException(
          'Keywords can only be changed on Search campaigns.',
        );
    }
    return { op: payload.op, text, matchType: payload.matchType, target };
  }

  private assertGoogleState(
    actionType: SocialAdManualActionType,
    change: Record<string, unknown>,
    state: GoogleAdWritableState,
    policy: SocialAdActionPolicyEntity,
  ) {
    if (actionType === 'set_status') {
      if (state.status === 'REMOVED')
        throw new BadRequestException('Removed objects cannot be changed.');
      return;
    }
    if (actionType === 'set_budget') {
      if (!state.budget)
        throw new UnprocessableEntityException({
          code: 'google_budget_not_found',
          message: 'This campaign has no budget that can be changed here.',
        });
      if (state.budget.shared)
        throw new UnprocessableEntityException({
          code: 'google_budget_shared',
          message:
            'This campaign uses a shared budget. Change it in Google Ads, where every campaign that uses it is visible.',
        });
      if (state.budget.period !== 'DAILY' || state.budget.amountMinor === null)
        throw new BadRequestException('Budget type cannot be changed here.');
      this.assertBudgetPolicy(
        state.budget.amountMinor,
        BigInt(String(change.budgetAmountMinor)),
        policy,
      );
      return;
    }
    if (change.op === 'add' && state.criterionResourceName)
      throw new ConflictException({
        code: 'google_keyword_exists',
        message: 'This keyword is already there.',
      });
    if (change.op === 'remove' && !state.criterionResourceName)
      throw new UnprocessableEntityException({
        code: 'google_keyword_not_found',
        message: 'This keyword was not found.',
      });
  }

  /** Google failures in the preflight become safe codes, never provider text. */
  private async callGoogle<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GoogleAdManualActionError) {
        throw new UnprocessableEntityException({
          code: error.code,
          message: 'Google Ads cannot apply this change.',
        });
      }
      if (
        error instanceof GoogleAdsMutationError &&
        error.kind === 'permanent'
      ) {
        throw new UnprocessableEntityException({
          code: error.code,
          reason: error.reason,
          message: 'Google Ads refused this change.',
        });
      }
      throw mapSocialAdSyncError(error);
    }
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
    provider: SocialAdManualActionProvider,
  ) {
    const row = await this.findPolicy(scope, connectionId);
    const allowed =
      row?.enabled &&
      this.providerActionTypes(provider).has(actionType) &&
      ((actionType === 'set_status' && row.allowStatus) ||
        (actionType === 'set_budget' && row.allowBudget) ||
        (actionType === 'set_end_time' && row.allowSchedule) ||
        (actionType === 'delete' && row.allowDelete) ||
        (KEYWORD_ACTION_TYPES.has(actionType) && row.allowKeywords));
    if (!row || !allowed)
      throw new ForbiddenException(
        'Manual action is disabled by account policy.',
      );
    return row;
  }

  private async requireConnection(
    scope: SocialCampaignsScope,
    connectionId: string,
    provider: SocialAdManualActionProvider,
  ) {
    const row = await this.connections.findOne({
      where: {
        id: connectionId,
        ...this.connectionScope(scope),
        provider,
      },
    });
    if (!row)
      throw new NotFoundException(
        `${PROVIDER_LABEL[provider]} connection not found.`,
      );
    return row;
  }

  private async requireEntity(
    scope: SocialCampaignsScope,
    input: {
      connectionId: string;
      entityLevel: 'campaign' | 'adset' | 'ad';
      entityExternalId: string;
    },
    provider: SocialAdManualActionProvider,
  ) {
    const row = await this.entities.findOne({
      where: {
        ...this.scopeWhere(scope),
        connectionId: input.connectionId,
        provider,
        entityLevel: input.entityLevel,
        externalId: input.entityExternalId,
      },
    });
    if (!row)
      throw new NotFoundException(
        `${PROVIDER_LABEL[provider]} object not found.`,
      );
    return row;
  }

  private providerActionTypes(provider: SocialAdManualActionProvider) {
    return provider === 'google_ads' ? GOOGLE_ACTION_TYPES : META_ACTION_TYPES;
  }

  private assertActionType(
    provider: SocialAdManualActionProvider,
    actionType: SocialAdManualActionType,
  ) {
    if (!this.providerActionTypes(provider).has(actionType))
      throw new BadRequestException(
        'This action is not available for this provider.',
      );
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

  private connectionScope(scope: SocialCampaignsScope) {
    return {
      ...this.scopeWhere(scope),
      companyContextId:
        scope.companyContextId == null ? IsNull() : scope.companyContextId,
    };
  }

  private assertGlobalEnabled(provider: SocialAdManualActionProvider) {
    if (!this.config.writesEnabledFor(provider))
      throw new ForbiddenException(
        `${PROVIDER_LABEL[provider]} writes are disabled.`,
      );
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
    provider: SocialAdManualActionProvider,
  ) {
    const google = provider === 'google_ads';
    return {
      connectionId,
      provider,
      globalWritesEnabled: this.config.writesEnabledFor(provider),
      mode: 'manual_only' as const,
      enabled: row?.enabled ?? false,
      allowStatus: row?.allowStatus ?? true,
      allowBudget: row?.allowBudget ?? false,
      allowSchedule: google ? false : (row?.allowSchedule ?? false),
      allowDelete: google ? false : (row?.allowDelete ?? false),
      allowBoost: google ? false : (row?.allowBoost ?? false),
      allowKeywords: google ? (row?.allowKeywords ?? false) : false,
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
