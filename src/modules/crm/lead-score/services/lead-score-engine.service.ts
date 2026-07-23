import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { InboxDomainOutboxEntity } from '../../../inbox/entities/inbox-domain-outbox.entity';
import { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import { CrmLeadScoreSnapshotEntity } from '../entities/crm-lead-score-snapshot.entity';
import { CrmLeadScoreStateEntity } from '../entities/crm-lead-score-state.entity';
import { LEAD_SCORE_HOT_THRESHOLD } from '../policy/lead-score-rules-v1.policy';
import {
  LEAD_SCORE_POLICY_PROVIDER,
  type LeadScoreCalculation,
  type LeadScoreCalculationReason,
  type LeadScorePolicyProvider,
} from '../lead-score.types';
import { calculateLeadScore } from './lead-score-calculator';
import { LeadScoreFeatureLoaderService } from './lead-score-feature-loader.service';

export const LEAD_SCORE_CHANGED_EVENT =
  'leadflow.crm.opportunity.score.changed';
export const LEAD_SCORE_HOT_LEAD_EVENT =
  'leadflow.crm.opportunity.hot_lead_detected';

export interface RecalculateLeadScoreInput {
  opportunityId: string;
  reason: LeadScoreCalculationReason;
  /** Domain event that caused this, when there is one. */
  sourceEventId?: string | null;
  sourceEventName?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
}

export interface LeadScoreRecalculationResult {
  snapshotId: string;
  score: number;
  band: string;
  previousScore: number | null;
  previousBand: string | null;
  changed: boolean;
  hotLeadDetected: boolean;
  replayed: boolean;
}

/**
 * Owns the current score, its history and its events.
 *
 * The whole write — projection, snapshot and outbox — happens in one
 * transaction, so a score can never exist without the history explaining it, or
 * an event announcing a score that was rolled back.
 */
@Injectable()
export class LeadScoreEngineService {
  private readonly logger = new Logger(LeadScoreEngineService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @Inject(LEAD_SCORE_POLICY_PROVIDER)
    private readonly policyProvider: LeadScorePolicyProvider,
    private readonly featureLoader: LeadScoreFeatureLoaderService,
  ) {}

  /**
   * Recomputes the score of one opportunity from canonical state.
   *
   * Idempotent on (scope, opportunity, cause, policy): a redelivered event
   * finds the snapshot it already wrote and changes nothing — no second row, no
   * repeated hot-lead announcement.
   */
  async recalculate(
    ctx: RequestContext,
    input: RecalculateLeadScoreInput,
  ): Promise<LeadScoreRecalculationResult> {
    return this.dataSource.transaction(async (manager) => {
      const opportunity = await this.findOpportunity(
        manager,
        ctx,
        input.opportunityId,
      );

      // Same lock vocabulary the CRM uses elsewhere, so a recalculation and a
      // stage change on the same deal serialise instead of racing.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          `${opportunity.tenantId}:${opportunity.workspaceId}:${opportunity.id}:lead_score`,
        ],
      );

      const policy = await this.policyProvider.getActivePolicy({
        tenantId: opportunity.tenantId,
        workspaceId: opportunity.workspaceId,
        businessModeKey: opportunity.businessMode ?? null,
      });

      const idempotencyKey = this.idempotencyKey(
        opportunity,
        input,
        policy.policyVersion,
      );
      const snapshots = manager.getRepository(CrmLeadScoreSnapshotEntity);
      const existing = await snapshots.findOne({ where: { idempotencyKey } });
      if (existing) {
        return {
          snapshotId: existing.id,
          score: existing.score,
          band: existing.band,
          previousScore: existing.previousScore,
          previousBand: existing.previousBand,
          changed: false,
          hotLeadDetected: false,
          replayed: true,
        };
      }

      const loaded = await this.featureLoader.load(
        manager,
        ctx,
        opportunity,
        policy,
      );
      const calculation = calculateLeadScore(
        policy,
        loaded.features,
        new Date(),
      );

      const states = manager.getRepository(CrmLeadScoreStateEntity);
      const previous = await states.findOne({
        where: { opportunityId: opportunity.id },
      });
      const previousScore = previous?.score ?? null;
      const previousBand = previous?.band ?? null;

      const snapshot = await snapshots.save(
        snapshots.create({
          tenantId: opportunity.tenantId,
          workspaceId: opportunity.workspaceId,
          opportunityId: opportunity.id,
          score: calculation.score,
          band: calculation.band,
          previousScore,
          previousBand,
          policyVersion: calculation.policyVersion,
          featureSchemaVersion: calculation.featureSchemaVersion,
          maxAchievable: calculation.maxAchievable,
          features: calculation.features,
          breakdown: calculation.breakdown,
          sourceEventId: input.sourceEventId ?? null,
          sourceEventName: input.sourceEventName ?? null,
          correlationId: input.correlationId ?? null,
          causationId: input.causationId ?? null,
          calculationReason: input.reason,
          opportunityRowVersion: opportunity.rowVersion,
          featureQueryCount: loaded.queryCount,
          featureDurationMs: loaded.durationMs,
          idempotencyKey,
          calculatedAt: calculation.calculatedAt,
        }),
      );

      await this.persistState(
        manager,
        opportunity,
        calculation,
        input,
        snapshot.id,
        previous,
      );

      const changed =
        previousScore !== calculation.score ||
        previousBand !== calculation.band;
      // Only a genuine crossing announces a hot lead. Staying above the line
      // is not news, and re-announcing it would make every recalculation look
      // like the lead had just heated up.
      const hotLeadDetected =
        calculation.score >= LEAD_SCORE_HOT_THRESHOLD &&
        (previousScore === null || previousScore < LEAD_SCORE_HOT_THRESHOLD);

      if (changed) {
        await this.emit(
          manager,
          opportunity,
          LEAD_SCORE_CHANGED_EVENT,
          snapshot.id,
          {
            opportunityId: opportunity.id,
            previousScore,
            currentScore: calculation.score,
            previousBand,
            currentBand: calculation.band,
            policyVersion: calculation.policyVersion,
            featureSchemaVersion: calculation.featureSchemaVersion,
            maxAchievable: calculation.maxAchievable,
            breakdownSummary: calculation.breakdown
              .filter((entry) => entry.outcome === 'contributed')
              .map((entry) => ({
                ruleId: entry.ruleId,
                appliedPoints: entry.appliedPoints,
              })),
            calculationReason: input.reason,
            calculatedAt: calculation.calculatedAt.toISOString(),
            correlationId: input.correlationId ?? null,
            causationId: input.causationId ?? null,
          },
        );
      }

      if (hotLeadDetected) {
        await this.emit(
          manager,
          opportunity,
          LEAD_SCORE_HOT_LEAD_EVENT,
          snapshot.id,
          {
            opportunityId: opportunity.id,
            previousScore,
            currentScore: calculation.score,
            threshold: LEAD_SCORE_HOT_THRESHOLD,
            policyVersion: calculation.policyVersion,
            calculationReason: input.reason,
            calculatedAt: calculation.calculatedAt.toISOString(),
            correlationId: input.correlationId ?? null,
            causationId: input.causationId ?? null,
          },
        );
      }

      return {
        snapshotId: snapshot.id,
        score: calculation.score,
        band: calculation.band,
        previousScore,
        previousBand,
        changed,
        hotLeadDetected,
        replayed: false,
      };
    });
  }

  /**
   * Recalculates without letting a failure break the caller's command.
   *
   * Used by CRM commands that already succeeded: refusing to save a legitimate
   * stage change because scoring failed would be the wrong trade. The failure
   * is logged and the opportunity simply keeps its previous score until the
   * next trigger or a backfill run.
   */
  async recalculateQuietly(
    ctx: RequestContext,
    input: RecalculateLeadScoreInput,
  ): Promise<void> {
    try {
      await this.recalculate(ctx, input);
    } catch (error) {
      this.logger.warn(
        `Lead score recalculation failed for ${input.opportunityId} (${input.reason}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async persistState(
    manager: EntityManager,
    opportunity: CrmOpportunityEntity,
    calculation: LeadScoreCalculation,
    input: RecalculateLeadScoreInput,
    snapshotId: string,
    previous: CrmLeadScoreStateEntity | null,
  ): Promise<void> {
    const states = manager.getRepository(CrmLeadScoreStateEntity);
    const next = {
      score: calculation.score,
      band: calculation.band,
      policyVersion: calculation.policyVersion,
      featureSchemaVersion: calculation.featureSchemaVersion,
      maxAchievable: calculation.maxAchievable,
      breakdown: calculation.breakdown,
      calculationReason: input.reason,
      calculatedAt: calculation.calculatedAt,
      lastSnapshotId: snapshotId,
    };

    if (previous) {
      await states.update({ id: previous.id }, next);
      return;
    }
    await states.save(
      states.create({
        tenantId: opportunity.tenantId,
        workspaceId: opportunity.workspaceId,
        opportunityId: opportunity.id,
        ...next,
      }),
    );
  }

  /** Writes a canonical event into the same outbox the CRM already uses. */
  private async emit(
    manager: EntityManager,
    opportunity: CrmOpportunityEntity,
    eventName: string,
    snapshotId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const outbox = manager.getRepository(InboxDomainOutboxEntity);
    await outbox.save(
      outbox.create({
        tenantId: opportunity.tenantId,
        workspaceId: opportunity.workspaceId,
        aggregateType: 'crm_opportunity',
        aggregateId: opportunity.id,
        eventName,
        eventVersion: 1,
        // Keyed on the snapshot, so replaying a calculation cannot publish the
        // same announcement twice.
        idempotencyKey: `lead-score:${eventName}:${snapshotId}`,
        payload,
        status: 'pending',
        publishedAt: null,
      }),
    );
  }

  private async findOpportunity(
    manager: EntityManager,
    ctx: RequestContext,
    opportunityId: string,
  ): Promise<CrmOpportunityEntity> {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const opportunity = await manager
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: {
          id: opportunityId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
    if (!opportunity) {
      throw new NotFoundException('Opportunity not found in this scope.');
    }
    return opportunity;
  }

  /**
   * Distinct per cause, so two different reasons both get recorded, but a
   * replay of the same cause does not. A calculation with no source event is
   * keyed on a fresh id: an operator asking twice means two answers.
   */
  private idempotencyKey(
    opportunity: CrmOpportunityEntity,
    input: RecalculateLeadScoreInput,
    policyVersion: string,
  ): string {
    const cause = input.sourceEventId ?? `${input.reason}:${randomUUID()}`;
    const digest = createHash('sha256')
      .update(
        [
          opportunity.tenantId,
          opportunity.workspaceId,
          opportunity.id,
          cause,
          policyVersion,
        ].join(':'),
      )
      .digest('hex');
    return `lead-score:${digest}`;
  }
}
