import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One property, one day (D-G5). Counters are `bigint` and come back from
 * Postgres as strings; the read service converts them. The unique key lives in
 * the migration as an expression index (NULL scope ids coalesced), so writers
 * use `ON CONFLICT` on that expression and `created_at` survives a re-sync.
 */
@Entity('social_ga4_daily_metrics')
export class SocialGa4DailyMetricEntity {
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

  @Column({ name: 'authorization_id', type: 'uuid', nullable: true })
  authorizationId!: string | null;

  @Column({ name: 'property_id', type: 'varchar', length: 20 })
  propertyId!: string;

  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  @Column({ type: 'bigint', default: 0 })
  sessions!: string;

  @Column({ name: 'total_users', type: 'bigint', default: 0 })
  totalUsers!: string;

  @Column({ name: 'new_users', type: 'bigint', default: 0 })
  newUsers!: string;

  @Column({ name: 'engaged_sessions', type: 'bigint', default: 0 })
  engagedSessions!: string;

  @Column({ name: 'event_count', type: 'bigint', default: 0 })
  eventCount!: string;

  @Column({
    name: 'key_events',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  keyEvents!: string;

  @Column({ name: 'page_views', type: 'bigint', default: 0 })
  pageViews!: string;

  @Column({
    name: 'total_revenue',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  totalRevenue!: string;

  @Column({
    name: 'avg_session_seconds',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  avgSessionSeconds!: string;

  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
