import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InboxMediaKind = 'audio' | 'image' | 'video' | 'document';
export type InboxMediaIngestionStatus =
  | 'pending'
  | 'processing'
  | 'available'
  | 'failed';

@Entity('inbox_media_assets')
@Index('idx_inbox_media_scope', ['tenantId', 'workspaceId'])
@Index('idx_inbox_media_message', ['tenantId', 'workspaceId', 'messageId'])
@Index(
  'uq_inbox_media_provider_ref',
  ['tenantId', 'workspaceId', 'channelId', 'provider', 'externalMediaId'],
  { unique: true },
)
export class InboxMediaAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ type: 'varchar', length: 24 })
  kind!: InboxMediaKind;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'external_media_id', type: 'varchar', length: 220 })
  externalMediaId!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'byte_size', type: 'bigint', nullable: true })
  byteSize!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum!: string | null;

  @Column({
    name: 'safe_filename',
    type: 'varchar',
    length: 220,
    nullable: true,
  })
  safeFilename!: string | null;

  @Column({ name: 'object_key', type: 'text', nullable: true })
  objectKey!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: InboxMediaIngestionStatus;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: 'available_at', type: 'timestamptz', nullable: true })
  availableAt!: Date | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
