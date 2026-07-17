import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('inbox_processing_batches')
@Index('idx_inbox_batch_due', ['status', 'dueAt'])
@Index(
  'uq_inbox_batch_open_conversation',
  ['tenantId', 'workspaceId', 'conversationId', 'generation'],
  { unique: true },
)
export class InboxProcessingBatchEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId!: string;
  @Column({ type: 'int', default: 1 }) generation!: number;
  @Column({ type: 'varchar', length: 24, default: 'pending' }) status!:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  @Column({ name: 'due_at', type: 'timestamptz' }) dueAt!: Date;
  @Column({ name: 'message_count', type: 'int', default: 1 })
  messageCount!: number;
  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;
  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;
  @Column({ name: 'claimed_by', type: 'varchar', length: 100, nullable: true })
  claimedBy!: string | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
