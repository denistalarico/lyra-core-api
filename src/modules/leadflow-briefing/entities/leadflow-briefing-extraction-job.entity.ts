import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';
import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';

/**
 * A background extraction attempt over one source version ("job"). Claim
 * columns (available_at/locked_at/locked_by) exist so F4-003's worker can
 * lease rows later — nothing claims them yet in this task.
 */
@Index('IDX_lf_briefing_jobs_claim', ['status', 'availableAt', 'lockedAt'])
@Index('IDX_lf_briefing_jobs_scope', [
  'tenantId',
  'workspaceId',
  'sourceId',
  'createdAt',
])
@Index('UQ_lf_briefing_jobs_idempotency', ['tenantId', 'workspaceId', 'idempotencyKey'], {
  unique: true,
})
@Entity('leadflow_briefing_extraction_jobs')
export class LeadFlowBriefingExtractionJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ name: 'source_version_id', type: 'uuid' })
  sourceVersionId!: string;

  @Column({ name: 'job_kind', type: 'varchar', length: 40, default: 'ai_extraction' })
  jobKind!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowBriefingJobStatus.Queued,
  })
  status!: LeadFlowBriefingJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'dead_lettered_at', type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 120, nullable: true })
  lastError!: string | null;

  @Column({ name: 'cost_budget_cents', type: 'int', nullable: true })
  costBudgetCents!: number | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: LeadFlowJsonObject;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
