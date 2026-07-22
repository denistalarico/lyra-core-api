import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  LeadFlowAutomationAttemptStatus,
  LeadFlowAutomationErrorClass,
} from '../enums/leadflow-automation-run.enums';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';

/**
 * One action carried out (or simulated) within a run.
 *
 * Separate from the run because a single run may request several effects — ask
 * the agent for copy, send through Inbox, notify a human — and each can fail
 * independently. Without per-action records, a retry could not tell which
 * effects were already confirmed, which is how duplicate messages happen.
 *
 * `effectConfirmed` is the field that makes a retry safe: an attempt whose
 * effect was confirmed must never be replayed.
 */
@Index('IDX_lf_run_attempts_run', ['runId', 'attemptNumber'])
@Index('IDX_lf_run_attempts_tenant_workspace', ['tenantId', 'workspaceId'])
@Entity('leadflow_automation_run_attempts')
export class LeadFlowAutomationRunAttemptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'attempt_number', type: 'integer', default: 1 })
  attemptNumber!: number;

  /** Which executor this attempt corresponds to (e.g. `send_message`). */
  @Column({ name: 'action_key', type: 'varchar', length: 60 })
  actionKey!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowAutomationAttemptStatus.Simulated,
  })
  status!: LeadFlowAutomationAttemptStatus;

  /** Only set on failure; decides whether a retry is worth attempting. */
  @Column({ name: 'error_class', type: 'varchar', length: 20, nullable: true })
  errorClass!: LeadFlowAutomationErrorClass | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  /** Sanitized. Provider responses are summarized, never stored verbatim. */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  /** What this attempt asked another domain to do. */
  @Column({
    name: 'effect_requested',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  effectRequested!: LeadFlowJsonObject;

  /** True only when the owning domain acknowledged the effect. */
  @Column({ name: 'effect_confirmed', type: 'boolean', default: false })
  effectConfirmed!: boolean;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
