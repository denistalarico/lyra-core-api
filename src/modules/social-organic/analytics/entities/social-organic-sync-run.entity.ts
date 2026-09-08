import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialOrganicSyncRunStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

/** Durable queue and audit log for organic metrics ingestion. */
@Entity('social_organic_sync_runs')
@Index('UQ_social_organic_sync_runs_inflight', ['assetId', 'idempotencyKey'], {
  unique: true,
  where: `"status" IN ('queued', 'processing')`,
})
@Index('IDX_social_organic_sync_runs_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'createdAt',
])
@Index('IDX_social_organic_sync_runs_queue', ['availableAt'], {
  where: `"status" = 'queued'`,
})
@Index('IDX_social_organic_sync_runs_stale_lock', ['lockedAt'], {
  where: `"status" = 'processing'`,
})
@Index('IDX_social_organic_sync_runs_asset', ['assetId', 'createdAt'])
@Check(
  'CK_social_organic_sync_runs_status',
  `"status" IN ('queued', 'processing', 'succeeded', 'partial', 'failed', 'dead_letter', 'cancelled')`,
)
@Check(
  'CK_social_organic_sync_runs_window',
  `"window_start" IS NULL OR "window_end" IS NULL OR "window_start" <= "window_end"`,
)
export class SocialOrganicSyncRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'run_kind', type: 'varchar', length: 40 })
  runKind!: string;

  @Column({ type: 'varchar', length: 24, default: 'queued' })
  status!: SocialOrganicSyncRunStatus;

  @Column({ name: 'window_start', type: 'date', nullable: true })
  windowStart!: string | null;

  @Column({ name: 'window_end', type: 'date', nullable: true })
  windowEnd!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'rows_written', type: 'integer', default: 0 })
  rowsWritten!: number;

  @Column({ name: 'rows_skipped', type: 'integer', default: 0 })
  rowsSkipped!: number;

  @Column({ name: 'api_calls', type: 'integer', default: 0 })
  apiCalls!: number;

  /** Safe internal code only; never persist raw provider messages. */
  @Column({ name: 'last_error', type: 'varchar', length: 240, nullable: true })
  lastError!: string | null;

  @Column({
    name: 'failed_segments',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  failedSegments!: unknown[];

  @Column({ name: 'cursor_state', type: 'jsonb', default: () => "'{}'::jsonb" })
  cursorState!: Record<string, unknown>;

  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
