import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LeadFlowWebhookDeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'retrying'
  | 'dead_letter'
  | 'skipped';

/**
 * One attempt history per (endpoint, source event).
 *
 * The unique pair is the idempotency boundary — the event stream is
 * at-least-once, so without it a redelivered event would post twice to a
 * customer's system.
 */
@Entity('leadflow_webhook_deliveries')
@Index('UQ_lf_webhook_deliveries_event', ['automationId', 'sourceEventId'], {
  unique: true,
})
export class LeadFlowWebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'automation_id', type: 'uuid' })
  automationId!: string;

  @Column({ name: 'source_event_id', type: 'uuid' })
  sourceEventId!: string;

  @Column({ name: 'event_name', type: 'varchar', length: 120 })
  eventName!: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: LeadFlowWebhookDeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'request_url', type: 'text' })
  requestUrl!: string;

  @Column({ name: 'response_status', type: 'integer', nullable: true })
  responseStatus!: number | null;

  /** Truncated answer body. Only stored when the endpoint asked us to read it. */
  @Column({ name: 'response_excerpt', type: 'text', nullable: true })
  responseExcerpt!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
