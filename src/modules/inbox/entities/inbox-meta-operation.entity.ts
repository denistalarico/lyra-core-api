import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InboxMetaOperationState =
  | 'reserved'
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'replayed'
  | 'unknown_outcome';

@Entity('inbox_meta_operations')
@Index(
  'uq_inbox_meta_operation_logical',
  ['tenantId', 'workspaceId', 'operation', 'idempotencyKey'],
  { unique: true },
)
@Index('idx_inbox_meta_operation_message', [
  'tenantId',
  'workspaceId',
  'messageId',
])
@Index('idx_inbox_meta_operation_retention', ['retainUntil'])
export class InboxMetaOperationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'message_id', type: 'uuid', nullable: true }) messageId!:
    | string
    | null;
  @Column({ type: 'varchar', length: 40 }) operation!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;
  @Column({ type: 'int', default: 1 }) attempt!: number;
  @Column({ type: 'varchar', length: 24, default: 'reserved' })
  state!: InboxMetaOperationState;
  @Column({ name: 'recipient_hash', type: 'char', length: 64 })
  recipientHash!: string;
  @Column({ name: 'recipient_masked', type: 'varchar', length: 32 })
  recipientMasked!: string;
  @Column({
    name: 'external_ref_hash',
    type: 'char',
    length: 64,
    nullable: true,
  })
  externalRefHash!: string | null;
  @Column({ name: 'latency_ms', type: 'int', nullable: true }) latencyMs!:
    | number
    | null;
  @Column({
    name: 'error_category',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  errorCategory!: string | null;
  @Column({
    name: 'cost_status',
    type: 'varchar',
    length: 20,
    default: 'unknown',
  })
  costStatus!: 'unknown' | 'known' | 'not_applicable';
  @Column({
    name: 'estimated_cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
  })
  estimatedCostUsd!: string | null;
  @Column({
    name: 'delivery_status',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  deliveryStatus!: string | null;
  @Column({ name: 'delivery_updated_at', type: 'timestamptz', nullable: true })
  deliveryUpdatedAt!: Date | null;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;
  @Column({ name: 'succeeded_at', type: 'timestamptz', nullable: true })
  succeededAt!: Date | null;
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
  @Column({ name: 'replayed_at', type: 'timestamptz', nullable: true })
  replayedAt!: Date | null;
  @Column({ name: 'replay_count', type: 'int', default: 0 })
  replayCount!: number;
  @Column({ name: 'retain_until', type: 'timestamptz' }) retainUntil!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
