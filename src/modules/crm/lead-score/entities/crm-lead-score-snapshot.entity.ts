import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  LeadScoreBand,
  LeadScoreBreakdownEntry,
  LeadScoreCalculationReason,
  LeadScoreFeatureSet,
} from '../lead-score.types';

/**
 * Immutable record of one calculation.
 *
 * Written on every recalculation that produced a result, not only on changes,
 * because the eventual Analytics work needs to know what was true at a moment —
 * including that nothing moved. Rows are never updated or deleted.
 *
 * Deliberately absent: any field describing what happened to the deal
 * afterwards. An outcome is in the future relative to the snapshot; recording
 * it here would mean rewriting history. A later reader joins these rows to the
 * opportunity's own `won`/`lost` events by `opportunity_id` and `calculated_at`.
 */
@Entity('crm_lead_score_snapshots')
@Index('idx_crm_lead_score_snapshots_opportunity', [
  'opportunityId',
  'calculatedAt',
])
@Index('idx_crm_lead_score_snapshots_scope', [
  'tenantId',
  'workspaceId',
  'calculatedAt',
])
@Index('uq_crm_lead_score_snapshots_idempotency', ['idempotencyKey'], {
  unique: true,
})
export class CrmLeadScoreSnapshotEntity {
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

  @Column({ name: 'previous_score', type: 'integer', nullable: true })
  previousScore!: number | null;

  @Column({
    name: 'previous_band',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  previousBand!: LeadScoreBand | null;

  @Column({ name: 'policy_version', type: 'varchar', length: 80 })
  policyVersion!: string;

  @Column({ name: 'feature_schema_version', type: 'varchar', length: 80 })
  featureSchemaVersion!: string;

  @Column({ name: 'max_achievable', type: 'integer' })
  maxAchievable!: number;

  /** Structured features only: counts, booleans, timestamps. Never message text. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  features!: LeadScoreFeatureSet;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  breakdown!: LeadScoreBreakdownEntry[];

  @Column({ name: 'source_event_id', type: 'uuid', nullable: true })
  sourceEventId!: string | null;

  @Column({
    name: 'source_event_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  sourceEventName!: string | null;

  @Column({ name: 'correlation_id', type: 'uuid', nullable: true })
  correlationId!: string | null;

  @Column({ name: 'causation_id', type: 'uuid', nullable: true })
  causationId!: string | null;

  @Column({ name: 'calculation_reason', type: 'varchar', length: 40 })
  calculationReason!: LeadScoreCalculationReason;

  /** Version the opportunity carried when the features were read. */
  @Column({ name: 'opportunity_row_version', type: 'integer', nullable: true })
  opportunityRowVersion!: number | null;

  /** Reads issued to assemble the features, so the cost stays measurable. */
  @Column({ name: 'feature_query_count', type: 'integer', default: 0 })
  featureQueryCount!: number;

  @Column({ name: 'feature_duration_ms', type: 'integer', default: 0 })
  featureDurationMs!: number;

  /**
   * Unique per (scope, opportunity, cause, policy). A replayed event finds the
   * existing row instead of writing a second one.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
