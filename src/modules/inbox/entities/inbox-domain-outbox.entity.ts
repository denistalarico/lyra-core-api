import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('inbox_domain_outbox')
@Index('idx_inbox_outbox_pending', ['publishedAt', 'createdAt'])
@Index(
  'uq_inbox_outbox_idempotency',
  ['tenantId', 'workspaceId', 'idempotencyKey'],
  { unique: true },
)
export class InboxDomainOutboxEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'aggregate_type', type: 'varchar', length: 60 })
  aggregateType!: string;
  @Column({ name: 'aggregate_id', type: 'uuid' }) aggregateId!: string;
  @Column({ name: 'event_name', type: 'varchar', length: 120 })
  eventName!: string;
  @Column({ name: 'event_version', type: 'int', default: 1 })
  eventVersion!: number;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) payload!: Record<
    string,
    unknown
  >;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: 'pending' | 'processing' | 'published' | 'skipped' | 'dead_letter';
  @Column({
    name: 'delivery_kind',
    type: 'varchar',
    length: 24,
    default: 'realtime',
  })
  deliveryKind!: 'realtime';
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;
  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;
  @Column({ name: 'last_error', type: 'varchar', length: 80, nullable: true })
  lastError!: string | null;
  @Column({ name: 'dead_lettered_at', type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;
  @Column({ name: 'skipped_at', type: 'timestamptz', nullable: true })
  skippedAt!: Date | null;
  @Column({ name: 'skip_reason', type: 'varchar', length: 80, nullable: true })
  skipReason!: string | null;
  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
