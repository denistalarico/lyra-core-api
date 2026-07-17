import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('inbox_media_derivatives')
@Index('idx_inbox_media_derivative_scope', [
  'tenantId',
  'workspaceId',
  'mediaAssetId',
])
@Index(
  'uq_inbox_media_derivative_processor',
  ['tenantId', 'workspaceId', 'mediaAssetId', 'kind', 'processorVersion'],
  { unique: true },
)
export class InboxMediaDerivativeEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'media_asset_id', type: 'uuid' }) mediaAssetId!: string;
  @Column({ type: 'varchar', length: 32 }) kind!: 'transcription' | 'vision';
  @Column({ type: 'varchar', length: 24, default: 'pending' }) status!:
    | 'pending'
    | 'processing'
    | 'available'
    | 'failed';
  @Column({ type: 'text', nullable: true }) content!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) language!:
    | string
    | null;
  @Column({ type: 'numeric', precision: 6, scale: 5, nullable: true })
  confidence!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) provider!:
    | string
    | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) model!:
    | string
    | null;
  @Column({ name: 'processor_version', type: 'varchar', length: 80 })
  processorVersion!: string;
  @Column({
    name: 'asset_checksum',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  assetChecksum!: string | null;
  @Column({ type: 'varchar', length: 24, nullable: true })
  outcome!: 'content' | 'empty' | 'indeterminate' | null;
  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;
  @Column({ name: 'available_at', type: 'timestamptz', nullable: true })
  availableAt!: Date | null;
  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;
  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  usage!: Record<string, unknown>;
  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs!: number | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
