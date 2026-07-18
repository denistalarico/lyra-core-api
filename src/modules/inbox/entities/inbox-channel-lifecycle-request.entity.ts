import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('inbox_channel_lifecycle_requests')
@Index(
  'uq_inbox_channel_lifecycle_idempotency',
  ['tenantId', 'workspaceId', 'channelId', 'idempotencyKey'],
  { unique: true },
)
export class InboxChannelLifecycleRequestEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'channel_id', type: 'uuid' }) channelId!: string;
  @Column({ type: 'varchar', length: 24 }) operation!:
    | 'pause'
    | 'resume'
    | 'disconnect'
    | 'reconnect';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) reason!:
    | string
    | null;
  @Column({
    name: 'result_status',
    type: 'varchar',
    length: 24,
    default: 'completed',
  })
  resultStatus!: string;
  @Column({ name: 'lifecycle_version', type: 'int' }) lifecycleVersion!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
