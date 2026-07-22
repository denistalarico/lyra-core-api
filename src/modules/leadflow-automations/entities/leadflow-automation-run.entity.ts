import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  LeadFlowAutomationRunMode,
  LeadFlowAutomationRunStatus,
} from '../enums/leadflow-automation-run.enums';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';

/**
 * One evaluation of an automation.
 *
 * This is the observability substrate the execution engine will write to. It
 * exists before the engine on purpose: the shape of what gets recorded is a
 * contract decision, and settling it now means the engine has somewhere honest
 * to report to instead of inventing its own log.
 *
 * `idempotencyKey` is unique per tenant/workspace so a retry of the same
 * trigger can never produce a second run.
 */
@Index('IDX_lf_runs_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('IDX_lf_runs_automation', ['automationId', 'createdAt'])
@Index('IDX_lf_runs_status', ['tenantId', 'workspaceId', 'status'])
@Index('IDX_lf_runs_mode', ['automationId', 'mode', 'createdAt'])
@Entity('leadflow_automation_runs')
export class LeadFlowAutomationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'automation_id', type: 'uuid' })
  automationId!: string;

  /** Published version snapshot this run evaluated, when one exists. */
  @Column({ name: 'automation_version_id', type: 'uuid', nullable: true })
  automationVersionId!: string | null;

  @Column({ name: 'recipe_key', type: 'varchar', length: 120 })
  recipeKey!: string;

  @Column({ name: 'template_version', type: 'integer', default: 1 })
  templateVersion!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowAutomationRunMode.DryRun,
  })
  mode!: LeadFlowAutomationRunMode;

  @Column({
    type: 'varchar',
    length: 20,
    default: LeadFlowAutomationRunStatus.Pending,
  })
  status!: LeadFlowAutomationRunStatus;

  /** Populated when the run finished without acting. */
  @Column({ name: 'skip_reason', type: 'varchar', length: 60, nullable: true })
  skipReason!: string | null;

  @Column({ name: 'trigger_type', type: 'varchar', length: 80 })
  triggerType!: string;

  @Column({ name: 'trigger_kind', type: 'varchar', length: 20 })
  triggerKind!: string;

  /** Domain event that caused this run. Null for operator-initiated dry-runs. */
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

  /** Unique per tenant/workspace — a retry must not create a second run. */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  idempotencyKey!: string | null;

  /** Minimal snapshot of what the decision was based on. */
  @Column({
    name: 'input_snapshot',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  inputSnapshot!: LeadFlowJsonObject;

  /** Structured outcome: which conditions passed, which actions were planned. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  result!: LeadFlowJsonObject;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  /** Sanitized message. Never carries provider payloads or PII. */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
