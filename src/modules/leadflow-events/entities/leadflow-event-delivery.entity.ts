import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LeadFlowEventDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'delivered'
  | 'skipped'
  | 'dead_letter';

/**
 * Durable, consumer-specific copy of one canonical LeadFlow outbox event.
 *
 * The payload is copied by the database trigger in the same transaction that
 * inserts the source event. This intentionally avoids a foreign key to the
 * realtime outbox: realtime retention can prune its row without deleting an
 * unprocessed delivery belonging to Automations (or a future consumer).
 */
@Entity('leadflow_event_deliveries')
@Index('IDX_lf_event_deliveries_claim', [
  'consumerKey',
  'status',
  'availableAt',
  'lockedAt',
  'occurredAt',
])
@Index('IDX_lf_event_deliveries_scope', [
  'tenantId',
  'workspaceId',
  'consumerKey',
  'occurredAt',
])
@Index(
  'UQ_lf_event_deliveries_source_consumer',
  ['sourceEventId', 'consumerKey'],
  { unique: true },
)
export class LeadFlowEventDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_event_id', type: 'uuid' })
  sourceEventId!: string;

  @Column({ name: 'consumer_key', type: 'varchar', length: 120 })
  consumerKey!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'event_name', type: 'varchar', length: 120 })
  eventName!: string;

  @Column({ name: 'event_version', type: 'integer' })
  eventVersion!: number;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 60 })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ name: 'source_idempotency_key', type: 'varchar', length: 180 })
  sourceIdempotencyKey!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: LeadFlowEventDeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'skipped_at', type: 'timestamptz', nullable: true })
  skippedAt!: Date | null;

  @Column({ name: 'skip_reason', type: 'varchar', length: 80, nullable: true })
  skipReason!: string | null;

  @Column({ name: 'dead_lettered_at', type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;

  @Column({ name: 'last_error', type: 'varchar', length: 80, nullable: true })
  lastError!: string | null;

  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
