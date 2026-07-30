import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowAutomationEntity } from '../../leadflow-automations/entities';
import { LeadFlowAutomationStatus } from '../../leadflow-automations/enums/leadflow-automation-status.enum';
import { LEADFLOW_AUTOMATIONS_PERMISSIONS } from '../../leadflow-automations/leadflow-automations.permissions';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { PlatformPermissionService } from '../../permissions';
import type { PermissionContext } from '../../permissions';
import type { DecideIntelligenceRecommendationDto } from '../dto/decide-intelligence-recommendation.dto';
import type { GenerateIntelligenceRecommendationsDto } from '../dto/generate-intelligence-recommendations.dto';
import type { GetIntelligenceRecommendationsDto } from '../dto/get-intelligence-recommendations.dto';
import {
  LeadFlowIntelligenceConfigVersionEntity,
  LeadFlowIntelligenceDecisionEntity,
  LeadFlowIntelligenceRecommendationEntity,
  LeadFlowIntelligenceResultEntity,
} from '../entities';
import type {
  LeadFlowIntelligenceJson,
  LeadFlowIntelligenceRecommendationResponse,
  LeadFlowIntelligenceRecommendationsResponse,
} from '../types/intelligence.types';
import {
  AUTOMATION_FAILURE_POLICY,
  buildAutomationFailureRecommendationCandidate,
} from './intelligence-recommendation.policy';

const AGENCY_CONNECTION = 'agency';
const MAX_ANALYSIS_DAYS = 366;
const MEASUREMENT_WINDOW_MS = 7 * 86_400_000;
const MAX_SNOOZE_MS = 90 * 86_400_000;

interface IntelligenceScope {
  tenantId: string;
  workspaceId: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
}

interface AutomationFailureRow {
  automationId: string;
  automationName: string;
  recipeKey: string;
  businessModeKey: string;
  succeededRuns: string | number;
  failedRuns: string | number;
}

@Injectable()
export class LeadFlowIntelligenceService {
  constructor(
    @InjectRepository(
      LeadFlowIntelligenceRecommendationEntity,
      AGENCY_CONNECTION,
    )
    private readonly recommendations: Repository<LeadFlowIntelligenceRecommendationEntity>,
    @InjectRepository(LeadFlowIntelligenceDecisionEntity, AGENCY_CONNECTION)
    private readonly decisions: Repository<LeadFlowIntelligenceDecisionEntity>,
    @InjectRepository(
      LeadFlowIntelligenceConfigVersionEntity,
      AGENCY_CONNECTION,
    )
    private readonly versions: Repository<LeadFlowIntelligenceConfigVersionEntity>,
    @InjectRepository(LeadFlowIntelligenceResultEntity, AGENCY_CONNECTION)
    private readonly results: Repository<LeadFlowIntelligenceResultEntity>,
    @InjectRepository(LeadFlowAutomationEntity, AGENCY_CONNECTION)
    private readonly automations: Repository<LeadFlowAutomationEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly permissions: PlatformPermissionService,
  ) {}

  async list(
    ctx: RequestContext,
    query: GetIntelligenceRecommendationsDto = {},
  ): Promise<LeadFlowIntelligenceRecommendationsResponse> {
    const scope = this.resolveScope(ctx);
    const where: FindOptionsWhere<LeadFlowIntelligenceRecommendationEntity> = {
      ...this.scopeWhere(scope),
      ...(query.businessMode ? { businessModeKey: query.businessMode } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const recommendations = await this.recommendations.find({
      where,
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return {
      items: await this.mapRecommendations(recommendations),
      policy: AUTOMATION_FAILURE_POLICY,
    };
  }

  async generate(
    ctx: RequestContext,
    query: GenerateIntelligenceRecommendationsDto,
  ): Promise<LeadFlowIntelligenceRecommendationsResponse> {
    const scope = this.resolveScope(ctx);
    const { from, to } = this.resolvePeriod(query);
    const rows = await this.automationFailureSamples(
      scope,
      from,
      to,
      query.businessMode ?? null,
    );
    let generatedCount = 0;

    for (const row of rows) {
      const candidate = buildAutomationFailureRecommendationCandidate({
        automationId: row.automationId,
        automationName: row.automationName,
        recipeKey: row.recipeKey,
        businessModeKey: row.businessModeKey,
        succeededRuns: Number(row.succeededRuns),
        failedRuns: Number(row.failedRuns),
      });
      if (!candidate) continue;

      const generationKey = [
        AUTOMATION_FAILURE_POLICY.key,
        row.automationId,
        from.toISOString(),
        to.toISOString(),
      ].join(':');
      const existing = await this.recommendations.findOne({
        where: { ...this.scopeWhere(scope), generationKey },
      });
      if (existing) continue;

      const recommendation = this.recommendations.create({
        ...scope,
        businessModeKey: row.businessModeKey,
        generationKey,
        kind: 'pause_automation_high_failure_rate',
        status: 'pending',
        targetType: 'automation',
        targetId: row.automationId,
        targetLabel: row.automationName,
        title: `Pausar ${row.automationName} para interromper falhas recorrentes`,
        rationale:
          'A amostra live do período superou o limiar de falhas da política. A proposta pausa somente esta automação; nenhuma configuração é alterada sem aprovação explícita.',
        periodFrom: from,
        periodTo: to,
        segment: candidate.segment,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        expectedImpact: {
          metric: 'failedLiveRuns',
          direction: 'decrease',
          hypothesis:
            'Interromper novas execuções live com falha enquanto a causa operacional é revisada.',
          measurementWindowDays: 7,
        },
        currentConfig: { status: LeadFlowAutomationStatus.Active },
        proposedConfig: { status: LeadFlowAutomationStatus.Paused },
        baseline: candidate.baseline,
        snoozedUntil: null,
        appliedAt: null,
        measurementDueAt: null,
        rolledBackAt: null,
        appliedVersionId: null,
        rollbackVersionId: null,
        latestResultId: null,
      });

      try {
        await this.recommendations.save(recommendation);
        generatedCount += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }

    const response = await this.list(ctx, {
      ...(query.businessMode ? { businessMode: query.businessMode } : {}),
    });
    return { ...response, generatedCount };
  }

  async decide(
    ctx: RequestContext,
    recommendationId: string,
    dto: DecideIntelligenceRecommendationDto,
  ): Promise<LeadFlowIntelligenceRecommendationResponse> {
    if (dto.action === 'approve') {
      await this.assertPermission(ctx, LEADFLOW_AUTOMATIONS_PERMISSIONS.pause);
      await this.applyApprovedRecommendation(ctx, recommendationId, dto.reason);
    } else {
      await this.recordNonApplyingDecision(ctx, recommendationId, dto);
    }
    return this.getOne(ctx, recommendationId);
  }

  async rollback(
    ctx: RequestContext,
    recommendationId: string,
  ): Promise<LeadFlowIntelligenceRecommendationResponse> {
    await this.assertPermission(ctx, LEADFLOW_AUTOMATIONS_PERMISSIONS.pause);
    await this.assertPermission(ctx, LEADFLOW_AUTOMATIONS_PERMISSIONS.activate);
    const scope = this.resolveScope(ctx);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const recommendation = await manager.findOne(
        LeadFlowIntelligenceRecommendationEntity,
        {
          where: { id: recommendationId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      this.assertRecommendationScope(recommendation, scope);
      if (
        recommendation.status !== 'applied' ||
        !recommendation.appliedVersionId
      ) {
        throw new ConflictException(
          'Somente uma recomendação aplicada pode ser revertida.',
        );
      }

      const appliedVersion = await manager.findOne(
        LeadFlowIntelligenceConfigVersionEntity,
        {
          where: { id: recommendation.appliedVersionId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      if (!appliedVersion) {
        throw new ConflictException(
          'A versão aplicada desta recomendação não foi encontrada.',
        );
      }
      const automation = await manager.findOne(LeadFlowAutomationEntity, {
        where: { id: recommendation.targetId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertAutomationScope(automation, scope);

      const appliedStatus = statusFromConfig(appliedVersion.config);
      const previousStatus = statusFromConfig(appliedVersion.previousConfig);
      if (automation.status !== appliedStatus) {
        throw new ConflictException(
          'A automação mudou após a aplicação. O rollback automático foi bloqueado para não sobrescrever uma decisão posterior.',
        );
      }

      const rollbackVersion = manager.create(
        LeadFlowIntelligenceConfigVersionEntity,
        {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          recommendationId: recommendation.id,
          targetType: recommendation.targetType,
          targetId: recommendation.targetId,
          version: await this.nextVersion(
            manager.getRepository(LeadFlowIntelligenceConfigVersionEntity),
            scope,
            recommendation.targetId,
          ),
          status: 'applied',
          previousConfig: appliedVersion.config,
          config: appliedVersion.previousConfig,
          rollbackOfVersionId: appliedVersion.id,
          appliedById: ctx.userId ?? null,
          appliedAt: now,
          rolledBackAt: null,
        },
      );
      await manager.save(rollbackVersion);

      automation.status = previousStatus;
      automation.updatedById = ctx.userId ?? null;
      await manager.save(automation);

      appliedVersion.status = 'rolled_back';
      appliedVersion.rolledBackAt = now;
      await manager.save(appliedVersion);

      await manager.save(
        manager.create(LeadFlowIntelligenceDecisionEntity, {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          recommendationId: recommendation.id,
          action: 'rollback',
          reason: null,
          snoozedUntil: null,
          actorUserId: ctx.userId ?? null,
        }),
      );

      recommendation.status = 'rolled_back';
      recommendation.rollbackVersionId = rollbackVersion.id;
      recommendation.rolledBackAt = now;
      await manager.save(recommendation);
    });

    return this.getOne(ctx, recommendationId);
  }

  async evaluate(
    ctx: RequestContext,
    recommendationId: string,
  ): Promise<LeadFlowIntelligenceRecommendationResponse> {
    const scope = this.resolveScope(ctx);
    const recommendation = await this.findScopedRecommendation(
      scope,
      recommendationId,
    );
    if (
      recommendation.status !== 'applied' ||
      !recommendation.appliedAt ||
      !recommendation.appliedVersionId
    ) {
      throw new ConflictException(
        'Somente uma recomendação ainda aplicada pode ser medida.',
      );
    }

    const measuredAt = new Date();
    const observedRows = (await this.automations.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE run.status = 'succeeded') AS "succeededRuns",
          COUNT(*) FILTER (WHERE run.status = 'failed') AS "failedRuns"
        FROM leadflow_automation_runs run
        WHERE run.tenant_id = $1
          AND run.workspace_id = $2
          AND run.automation_id = $3
          AND run.mode = 'live'
          AND run.created_at >= $4
          AND run.created_at <= $5
      `,
      [
        scope.tenantId,
        scope.workspaceId,
        recommendation.targetId,
        recommendation.appliedAt,
        measuredAt,
      ],
    )) as unknown as Array<{
      succeededRuns: string | number;
      failedRuns: string | number;
    }>;
    const succeededRuns = Number(observedRows[0]?.succeededRuns ?? 0);
    const failedRuns = Number(observedRows[0]?.failedRuns ?? 0);
    const terminalLiveRuns = succeededRuns + failedRuns;
    const failureRate =
      terminalLiveRuns === 0 ? 0 : round(failedRuns / terminalLiveRuns);
    const baselineFailureRate = numberFromJson(
      recommendation.baseline,
      'failureRate',
    );
    const due = recommendation.measurementDueAt;
    const insufficientWindow = Boolean(due && measuredAt < due);
    const status = insufficientWindow
      ? 'insufficient_window'
      : failureRate < baselineFailureRate
        ? 'improved'
        : failureRate > baselineFailureRate
          ? 'regressed'
          : 'no_change';
    const conclusion = insufficientWindow
      ? 'A janela mínima de sete dias ainda não terminou; o resultado permanece inconclusivo.'
      : failedRuns === 0
        ? 'Nenhuma nova execução live com falha foi observada enquanto a automação permaneceu pausada.'
        : status === 'improved'
          ? 'A taxa de falha observada ficou abaixo da linha de base.'
          : status === 'regressed'
            ? 'A taxa de falha observada ficou acima da linha de base.'
            : 'A taxa de falha observada não mudou em relação à linha de base.';

    const result = await this.results.save(
      this.results.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        recommendationId: recommendation.id,
        configVersionId: recommendation.appliedVersionId,
        status,
        periodFrom: recommendation.appliedAt,
        periodTo: measuredAt,
        baseline: recommendation.baseline,
        observed: {
          terminalLiveRuns,
          succeededRuns,
          failedRuns,
          failureRate,
        },
        delta: {
          failedRuns:
            failedRuns - numberFromJson(recommendation.baseline, 'failedRuns'),
          failureRate: round(failureRate - baselineFailureRate),
        },
        conclusion,
        measuredAt,
      }),
    );
    recommendation.latestResultId = result.id;
    await this.recommendations.save(recommendation);
    return this.getOne(ctx, recommendationId);
  }

  private async applyApprovedRecommendation(
    ctx: RequestContext,
    recommendationId: string,
    reason?: string,
  ): Promise<void> {
    const scope = this.resolveScope(ctx);
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const recommendation = await manager.findOne(
        LeadFlowIntelligenceRecommendationEntity,
        {
          where: { id: recommendationId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      this.assertRecommendationScope(recommendation, scope);
      if (!['pending', 'snoozed'].includes(recommendation.status)) {
        throw new ConflictException(
          'Esta recomendação já recebeu uma decisão final.',
        );
      }
      if (recommendation.targetType !== 'automation') {
        throw new ConflictException(
          'O alvo desta recomendação não possui adaptador de aplicação.',
        );
      }

      const automation = await manager.findOne(LeadFlowAutomationEntity, {
        where: { id: recommendation.targetId },
        lock: { mode: 'pessimistic_write' },
      });
      this.assertAutomationScope(automation, scope);
      const currentStatus = statusFromConfig(recommendation.currentConfig);
      const proposedStatus = statusFromConfig(recommendation.proposedConfig);
      if (automation.status !== currentStatus) {
        throw new ConflictException(
          'A configuração atual divergiu da evidência. Gere uma nova análise antes de aprovar.',
        );
      }
      if (proposedStatus !== LeadFlowAutomationStatus.Paused) {
        throw new ConflictException(
          'A configuração proposta não é suportada pelo adaptador atual.',
        );
      }

      const version = manager.create(LeadFlowIntelligenceConfigVersionEntity, {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        recommendationId: recommendation.id,
        targetType: recommendation.targetType,
        targetId: recommendation.targetId,
        version: await this.nextVersion(
          manager.getRepository(LeadFlowIntelligenceConfigVersionEntity),
          scope,
          recommendation.targetId,
        ),
        status: 'applied',
        previousConfig: recommendation.currentConfig,
        config: recommendation.proposedConfig,
        rollbackOfVersionId: null,
        appliedById: ctx.userId ?? null,
        appliedAt: now,
        rolledBackAt: null,
      });
      await manager.save(version);

      automation.status = proposedStatus;
      automation.updatedById = ctx.userId ?? null;
      await manager.save(automation);

      await manager.save(
        manager.create(LeadFlowIntelligenceDecisionEntity, {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          recommendationId: recommendation.id,
          action: 'approve',
          reason: normalizeReason(reason),
          snoozedUntil: null,
          actorUserId: ctx.userId ?? null,
        }),
      );

      recommendation.status = 'applied';
      recommendation.snoozedUntil = null;
      recommendation.appliedAt = now;
      recommendation.measurementDueAt = new Date(
        now.getTime() + MEASUREMENT_WINDOW_MS,
      );
      recommendation.appliedVersionId = version.id;
      await manager.save(recommendation);
    });
  }

  private async recordNonApplyingDecision(
    ctx: RequestContext,
    recommendationId: string,
    dto: DecideIntelligenceRecommendationDto,
  ): Promise<void> {
    const scope = this.resolveScope(ctx);
    const now = new Date();
    const snoozedUntil =
      dto.action === 'snooze'
        ? this.resolveSnooze(dto.snoozedUntil, now)
        : null;

    await this.dataSource.transaction(async (manager) => {
      const recommendation = await manager.findOne(
        LeadFlowIntelligenceRecommendationEntity,
        {
          where: { id: recommendationId },
          lock: { mode: 'pessimistic_write' },
        },
      );
      this.assertRecommendationScope(recommendation, scope);
      if (!['pending', 'snoozed'].includes(recommendation.status)) {
        throw new ConflictException(
          'Esta recomendação já recebeu uma decisão final.',
        );
      }
      await manager.save(
        manager.create(LeadFlowIntelligenceDecisionEntity, {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          recommendationId: recommendation.id,
          action: dto.action,
          reason: normalizeReason(dto.reason),
          snoozedUntil,
          actorUserId: ctx.userId ?? null,
        }),
      );
      recommendation.status = dto.action === 'reject' ? 'rejected' : 'snoozed';
      recommendation.snoozedUntil = snoozedUntil;
      await manager.save(recommendation);
    });
  }

  private async getOne(
    ctx: RequestContext,
    id: string,
  ): Promise<LeadFlowIntelligenceRecommendationResponse> {
    const scope = this.resolveScope(ctx);
    const recommendation = await this.findScopedRecommendation(scope, id);
    const [mapped] = await this.mapRecommendations([recommendation]);
    return mapped;
  }

  private async mapRecommendations(
    recommendations: LeadFlowIntelligenceRecommendationEntity[],
  ): Promise<LeadFlowIntelligenceRecommendationResponse[]> {
    if (recommendations.length === 0) return [];
    const ids = recommendations.map((item) => item.id);
    const [decisions, versions, results] = await Promise.all([
      this.decisions.find({
        where: { recommendationId: In(ids) },
        order: { createdAt: 'ASC' },
      }),
      this.versions.find({
        where: { recommendationId: In(ids) },
        order: { version: 'ASC' },
      }),
      this.results.find({
        where: { recommendationId: In(ids) },
        order: { measuredAt: 'DESC' },
      }),
    ]);

    return recommendations.map((recommendation) => {
      const latestResult = results.find(
        (result) =>
          result.id === recommendation.latestResultId ||
          (!recommendation.latestResultId &&
            result.recommendationId === recommendation.id),
      );
      return {
        id: recommendation.id,
        kind: recommendation.kind,
        status: recommendation.status,
        title: recommendation.title,
        rationale: recommendation.rationale,
        target: {
          type: recommendation.targetType,
          id: recommendation.targetId,
          label: recommendation.targetLabel,
        },
        period: {
          from: recommendation.periodFrom.toISOString(),
          to: recommendation.periodTo.toISOString(),
        },
        segment: recommendation.segment,
        evidence: recommendation.evidence,
        confidence: recommendation.confidence,
        expectedImpact: recommendation.expectedImpact,
        currentConfig: recommendation.currentConfig,
        proposedConfig: recommendation.proposedConfig,
        baseline: recommendation.baseline,
        generatedAt: recommendation.createdAt.toISOString(),
        snoozedUntil: recommendation.snoozedUntil?.toISOString() ?? null,
        appliedAt: recommendation.appliedAt?.toISOString() ?? null,
        measurementDueAt:
          recommendation.measurementDueAt?.toISOString() ?? null,
        rolledBackAt: recommendation.rolledBackAt?.toISOString() ?? null,
        decisions: decisions
          .filter((item) => item.recommendationId === recommendation.id)
          .map((item) => ({
            id: item.id,
            action: item.action,
            reason: item.reason,
            snoozedUntil: item.snoozedUntil?.toISOString() ?? null,
            actorUserId: item.actorUserId,
            createdAt: item.createdAt.toISOString(),
          })),
        versions: versions
          .filter((item) => item.recommendationId === recommendation.id)
          .map((item) => ({
            id: item.id,
            version: item.version,
            status: item.status,
            previousConfig: item.previousConfig,
            config: item.config,
            rollbackOfVersionId: item.rollbackOfVersionId,
            appliedAt: item.appliedAt.toISOString(),
            rolledBackAt: item.rolledBackAt?.toISOString() ?? null,
          })),
        latestResult: latestResult
          ? {
              id: latestResult.id,
              status: latestResult.status,
              period: {
                from: latestResult.periodFrom.toISOString(),
                to: latestResult.periodTo.toISOString(),
              },
              baseline: latestResult.baseline,
              observed: latestResult.observed,
              delta: latestResult.delta,
              conclusion: latestResult.conclusion,
              measuredAt: latestResult.measuredAt.toISOString(),
            }
          : null,
      };
    });
  }

  private async automationFailureSamples(
    scope: IntelligenceScope,
    from: Date,
    to: Date,
    businessMode: string | null,
  ): Promise<AutomationFailureRow[]> {
    return this.automations.query(
      `
        SELECT
          automation.id AS "automationId",
          automation.name AS "automationName",
          automation.recipe_key AS "recipeKey",
          automation.business_mode_key AS "businessModeKey",
          COUNT(*) FILTER (WHERE run.status = 'succeeded') AS "succeededRuns",
          COUNT(*) FILTER (WHERE run.status = 'failed') AS "failedRuns"
        FROM leadflow_automations automation
        INNER JOIN leadflow_automation_runs run
          ON run.automation_id = automation.id
         AND run.tenant_id = automation.tenant_id
         AND run.workspace_id = automation.workspace_id
        WHERE automation.tenant_id = $1
          AND automation.workspace_id = $2
          AND automation.context_type = $3
          AND automation.agency_client_id IS NOT DISTINCT FROM $4::uuid
          AND automation.status = 'active'
          AND ($5::varchar IS NULL OR automation.business_mode_key = $5)
          AND run.mode = 'live'
          AND run.status IN ('succeeded', 'failed')
          AND run.created_at >= $6
          AND run.created_at <= $7
        GROUP BY
          automation.id,
          automation.name,
          automation.recipe_key,
          automation.business_mode_key
        ORDER BY automation.id
      `,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.contextType,
        scope.agencyClientId,
        businessMode,
        from,
        to,
      ],
    );
  }

  private resolvePeriod(query: GenerateIntelligenceRecommendationsDto) {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to
    ) {
      throw new BadRequestException('O período da análise é inválido.');
    }
    if (to.getTime() > now.getTime() + 5 * 60_000) {
      throw new BadRequestException(
        'O período da análise não pode terminar no futuro.',
      );
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_ANALYSIS_DAYS) {
      throw new BadRequestException(
        `O período da análise não pode exceder ${MAX_ANALYSIS_DAYS} dias.`,
      );
    }
    return { from, to };
  }

  private resolveSnooze(value: string | undefined, now: Date): Date {
    if (!value) {
      throw new BadRequestException(
        'Informe até quando a recomendação deve ser adiada.',
      );
    }
    const snoozedUntil = new Date(value);
    if (
      Number.isNaN(snoozedUntil.getTime()) ||
      snoozedUntil <= now ||
      snoozedUntil.getTime() - now.getTime() > MAX_SNOOZE_MS
    ) {
      throw new BadRequestException(
        'O adiamento deve terminar no futuro e em no máximo 90 dias.',
      );
    }
    return snoozedUntil;
  }

  private async nextVersion(
    repository: Repository<LeadFlowIntelligenceConfigVersionEntity>,
    scope: IntelligenceScope,
    targetId: string,
  ): Promise<number> {
    const latest = await repository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        targetType: 'automation',
        targetId,
      },
      order: { version: 'DESC' },
    });
    return (latest?.version ?? 0) + 1;
  }

  private async findScopedRecommendation(
    scope: IntelligenceScope,
    id: string,
  ): Promise<LeadFlowIntelligenceRecommendationEntity> {
    const recommendation = await this.recommendations.findOne({
      where: { ...this.scopeWhere(scope), id },
    });
    if (!recommendation) {
      throw new NotFoundException(
        'Recomendação não encontrada neste contexto.',
      );
    }
    return recommendation;
  }

  private assertRecommendationScope(
    recommendation: LeadFlowIntelligenceRecommendationEntity | null,
    scope: IntelligenceScope,
  ): asserts recommendation is LeadFlowIntelligenceRecommendationEntity {
    if (
      !recommendation ||
      recommendation.tenantId !== scope.tenantId ||
      recommendation.workspaceId !== scope.workspaceId ||
      recommendation.contextType !== scope.contextType ||
      recommendation.agencyClientId !== scope.agencyClientId
    ) {
      throw new NotFoundException(
        'Recomendação não encontrada neste contexto.',
      );
    }
  }

  private assertAutomationScope(
    automation: LeadFlowAutomationEntity | null,
    scope: IntelligenceScope,
  ): asserts automation is LeadFlowAutomationEntity {
    if (
      !automation ||
      automation.tenantId !== scope.tenantId ||
      automation.workspaceId !== scope.workspaceId ||
      automation.contextType !== scope.contextType ||
      automation.agencyClientId !== scope.agencyClientId
    ) {
      throw new NotFoundException(
        'Automação alvo não encontrada neste contexto.',
      );
    }
  }

  private resolveScope(ctx: RequestContext): IntelligenceScope {
    if (!ctx.tenantId) {
      throw new BadRequestException('Tenant context is required.');
    }
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const agencyClientId =
      ctx.managedContext?.operatingMode === 'client'
        ? ctx.managedContext.clientId
        : null;
    if (ctx.managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Managed client context is required.');
    }
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      contextType: agencyClientId
        ? LeadFlowSettingsContextType.Client
        : LeadFlowSettingsContextType.Agency,
      agencyClientId,
    };
  }

  private scopeWhere(
    scope: IntelligenceScope,
  ): FindOptionsWhere<LeadFlowIntelligenceRecommendationEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      contextType: scope.contextType,
      agencyClientId: scope.agencyClientId ?? IsNull(),
    };
  }

  private async assertPermission(
    ctx: RequestContext,
    permission: string,
  ): Promise<void> {
    if (!ctx.userId || !ctx.role) {
      throw new BadRequestException('User context is required.');
    }
    const permissionContext: PermissionContext = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role,
    };
    await this.permissions.assertCan(permissionContext, permission);
  }
}

function statusFromConfig(config: LeadFlowIntelligenceJson) {
  const value = config.status;
  if (
    value !== LeadFlowAutomationStatus.Active &&
    value !== LeadFlowAutomationStatus.Paused
  ) {
    throw new ConflictException(
      'A versão não contém um status de automação suportado.',
    );
  }
  return value;
}

function normalizeReason(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function numberFromJson(value: LeadFlowIntelligenceJson, key: string): number {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : 0;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
