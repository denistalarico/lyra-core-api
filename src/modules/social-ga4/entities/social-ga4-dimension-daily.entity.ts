import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const GA4_DIMENSIONS = [
  'channel_group',
  'source_medium',
  'campaign',
  'landing_page',
  'device',
  'country',
] as const;
export type Ga4Dimension = (typeof GA4_DIMENSIONS)[number];

/** Property × day × dimension × value (D-G5). See the daily entity for keys. */
@Entity('social_ga4_dimension_daily')
export class SocialGa4DimensionDailyEntity {
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

  @Column({ type: 'varchar', length: 32 })
  dimension!: Ga4Dimension;

  @Column({ name: 'dimension_value', type: 'varchar', length: 300 })
  dimensionValue!: string;

  @Column({ type: 'bigint', default: 0 })
  sessions!: string;

  @Column({ name: 'engaged_sessions', type: 'bigint', default: 0 })
  engagedSessions!: string;

  @Column({ name: 'total_users', type: 'bigint', default: 0 })
  totalUsers!: string;

  @Column({
    name: 'key_events',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  keyEvents!: string;

  @Column({
    name: 'total_revenue',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  totalRevenue!: string;

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
