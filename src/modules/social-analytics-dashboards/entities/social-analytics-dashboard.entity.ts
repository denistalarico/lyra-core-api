import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  DashboardChannelId,
  DashboardLayout,
} from '../dashboard-layout.contract';

@Entity('social_analytics_dashboards')
@Index('IDX_social_analytics_dashboards_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'createdAt',
])
export class SocialAnalyticsDashboardEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ type: 'varchar', length: 120 }) name!: string;

  /**
   * The dashboard every scope has and nobody may delete.
   *
   * Seeded lazily on first read rather than by the migration: the scope quartet
   * is only known when somebody in it asks, and a migration cannot enumerate
   * company contexts that do not exist yet.
   */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  /**
   * Set when this row is the fixed screen for one channel, null otherwise.
   *
   * Written by the seeder and by nothing else. Recognising these rows by name,
   * or by "one channel and not default", would promote a dashboard the operator
   * built by hand into an undeletable screen and rename it under them.
   */
  @Column({ name: 'channel_key', type: 'varchar', length: 32, nullable: true })
  channelKey!: DashboardChannelId | null;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  channels!: DashboardChannelId[];

  @Column({
    type: 'jsonb',
    default: () => `'{"version":1,"sections":[]}'::jsonb`,
  })
  layout!: DashboardLayout;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
