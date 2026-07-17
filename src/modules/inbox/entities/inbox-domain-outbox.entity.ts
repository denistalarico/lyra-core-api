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
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
