import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type Ga4SyncRunStatus =
  | 'processing'
  | 'succeeded'
  | 'partial'
  | 'failed';
export type Ga4SyncTrigger = 'scheduled' | 'manual';

/**
 * Log and lock of GA4 syncs. A sibling of `social_ad_sync_runs` on purpose
 * (G3 §8): no queue, no leasing, because the sync runs in-process; the partial
 * unique index on `processing` is the per-(property, window) lock.
 */
@Entity('social_ga4_sync_runs')
export class SocialGa4SyncRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ name: 'property_id', type: 'varchar', length: 20 })
  propertyId!: string;

  @Column({ type: 'varchar', length: 16 })
  trigger!: Ga4SyncTrigger;

  @Column({ name: 'window_start', type: 'date' })
  windowStart!: string;

  @Column({ name: 'window_end', type: 'date' })
  windowEnd!: string;

  @Column({ type: 'varchar', length: 16, default: 'processing' })
  status!: Ga4SyncRunStatus;

  @Column({ name: 'rows_written', type: 'integer', default: 0 })
  rowsWritten!: number;

  @Column({ name: 'api_calls', type: 'integer', default: 0 })
  apiCalls!: number;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
