import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ScheduledTimerPurpose, ScheduledTimerStatus } from '../scheduler';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';

export type LeadFlowScheduledTimerRuntimeStatus =
  | ScheduledTimerStatus
  | 'processing'
  | 'dead_letter';

/**
 * Durable clock entry for LeadFlow.
 *
 * The partial unique index created by the migration (rather than this decorator)
 * enforces one active timer per tenant/workspace/scope/key while allowing a new
 * cycle after a timer fired, was cancelled or was superseded.
 */
@Entity('leadflow_scheduled_timers')
@Index('IDX_lf_scheduled_timers_claim', [
  'status',
  'availableAt',
  'fireAt',
  'lockedAt',
])
@Index('IDX_lf_scheduled_timers_scope', [
  'tenantId',
  'workspaceId',
  'consumerKey',
  'createdAt',
])
export class LeadFlowScheduledTimerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'timer_key', type: 'varchar', length: 240 })
  timerKey!: string;

  @Column({ name: 'dedupe_scope', type: 'varchar', length: 180, default: '' })
  dedupeScope!: string;

  @Column({ name: 'fire_at', type: 'timestamptz' })
  fireAt!: Date;

  @Column({ type: 'varchar', length: 48 })
  purpose!: ScheduledTimerPurpose;

  @Column({ name: 'consumer_key', type: 'varchar', length: 120 })
  consumerKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: LeadFlowJsonObject;

  @Column({ type: 'varchar', length: 24, default: 'scheduled' })
  status!: LeadFlowScheduledTimerRuntimeStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 8 })
  maxAttempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 140, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'fired_at', type: 'timestamptz', nullable: true })
  firedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;

  @Column({ name: 'dead_lettered_at', type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 100, nullable: true })
  lastError!: string | null;

  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
