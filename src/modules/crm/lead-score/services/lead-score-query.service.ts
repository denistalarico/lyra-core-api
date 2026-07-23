import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmLeadScoreStateEntity } from '../entities/crm-lead-score-state.entity';
import type {
  LeadScoreBand,
  LeadScoreBreakdownEntry,
} from '../lead-score.types';

/** Why a score is not available for an opportunity. */
export type LeadScoreAvailability =
  /** Calculated and current. */
  | 'available'
  /** The opportunity exists but has never been scored. */
  | 'not_calculated';

export interface LeadScoreReadModel {
  opportunityId: string;
  availability: LeadScoreAvailability;
  score: number | null;
  band: LeadScoreBand | null;
  policyVersion: string | null;
  featureSchemaVersion: string | null;
  maxAchievable: number | null;
  calculatedAt: string | null;
  /** Omitted unless the caller is entitled to the explanation. */
  breakdown: LeadScoreBreakdownEntry[] | null;
}

/**
 * The single canonical read of a lead score.
 *
 * Everything outside the CRM — the opportunity UI today, the Automations
 * context loader next — reads through here. A second reader computing its own
 * number from the same signals would be a second source of truth, and the two
 * would disagree the first time a rule changed.
 *
 * Scope is always the caller's, never taken from an argument that could be
 * supplied by a payload.
 */
@Injectable()
export class LeadScoreQueryService {
  constructor(
    @InjectRepository(CrmLeadScoreStateEntity, 'agency')
    private readonly statesRepository: Repository<CrmLeadScoreStateEntity>,
  ) {}

  async getForOpportunity(
    scope: { tenantId: string; workspaceId: string },
    opportunityId: string,
    options: { includeBreakdown?: boolean } = {},
  ): Promise<LeadScoreReadModel> {
    const state = await this.statesRepository.findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        opportunityId,
      },
    });

    if (!state) {
      // Never a zero. An unscored opportunity has no score, and reporting 0
      // would place it in the cold band on no evidence at all.
      return {
        opportunityId,
        availability: 'not_calculated',
        score: null,
        band: null,
        policyVersion: null,
        featureSchemaVersion: null,
        maxAchievable: null,
        calculatedAt: null,
        breakdown: null,
      };
    }

    return {
      opportunityId,
      availability: 'available',
      score: state.score,
      band: state.band,
      policyVersion: state.policyVersion,
      featureSchemaVersion: state.featureSchemaVersion,
      maxAchievable: state.maxAchievable,
      calculatedAt: state.calculatedAt.toISOString(),
      breakdown: options.includeBreakdown ? state.breakdown : null,
    };
  }

  /** Batched read, for callers scoring a list of opportunities at once. */
  async getForOpportunities(
    scope: { tenantId: string; workspaceId: string },
    opportunityIds: string[],
  ): Promise<Map<string, LeadScoreReadModel>> {
    const result = new Map<string, LeadScoreReadModel>();
    if (opportunityIds.length === 0) return result;

    const states = await this.statesRepository.find({
      where: opportunityIds.map((opportunityId) => ({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        opportunityId,
      })),
    });
    const byOpportunity = new Map(
      states.map((state) => [state.opportunityId, state]),
    );

    for (const opportunityId of opportunityIds) {
      const state = byOpportunity.get(opportunityId);
      result.set(opportunityId, {
        opportunityId,
        availability: state ? 'available' : 'not_calculated',
        score: state?.score ?? null,
        band: state?.band ?? null,
        policyVersion: state?.policyVersion ?? null,
        featureSchemaVersion: state?.featureSchemaVersion ?? null,
        maxAchievable: state?.maxAchievable ?? null,
        calculatedAt: state?.calculatedAt.toISOString() ?? null,
        breakdown: null,
      });
    }
    return result;
  }
}
