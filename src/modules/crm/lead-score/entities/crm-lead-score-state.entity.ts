import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  LeadScoreBand,
  LeadScoreBreakdownEntry,
  LeadScoreCalculationReason,
} from '../lead-score.types';

/**
 * Current score of one opportunity: a 1:1 projection, not columns on the deal.
 *
 * Kept apart from `crm_opportunities` on purpose. Writing the score onto the
 * opportunity would bump its `row_version` and `updated_at`, which the CRM
 * treats as the deal itself having changed — emitting `opportunity.updated`,
 * which would in turn be a reason to recalculate the score. Separating the
 * projection makes that loop impossible by construction rather than by a guard
 * someone has to remember.
 */
@Entity('crm_lead_score_states')
@Index('uq_crm_lead_score_states_opportunity', ['opportunityId'], {
  unique: true,
})
@Index('idx_crm_lead_score_states_scope_band', [
  'tenantId',
  'workspaceId',
  'band',
])
export class CrmLeadScoreStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @Column({ type: 'integer' })
  score!: number;

  @Column({ type: 'varchar', length: 16 })
  band!: LeadScoreBand;

  @Column({ name: 'policy_version', type: 'varchar', length: 80 })
  policyVersion!: string;

  @Column({ name: 'feature_schema_version', type: 'varchar', length: 80 })
  featureSchemaVersion!: string;

  /**
   * Highest score the policy's active rules could award. Without it a reader
   * cannot tell a cold lead from a policy that can only measure 45 points.
   */
  @Column({ name: 'max_achievable', type: 'integer' })
  maxAchievable!: number;

  /** Per-rule contributions of the most recent calculation. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  breakdown!: LeadScoreBreakdownEntry[];

  @Column({ name: 'calculation_reason', type: 'varchar', length: 40 })
  calculationReason!: LeadScoreCalculationReason;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt!: Date;

  /** Snapshot this state was materialised from. */
  @Column({ name: 'last_snapshot_id', type: 'uuid', nullable: true })
  lastSnapshotId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
