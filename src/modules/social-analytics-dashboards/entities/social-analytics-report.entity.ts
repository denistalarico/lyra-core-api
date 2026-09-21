import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { DashboardChannelId } from '../dashboard-layout.contract';

/**
 * A report that was emitted from a dashboard (aba Relatórios, Etapa 9).
 *
 * The table is created now, with the dashboards it references, because the FK
 * direction makes them one migration: adding it later would mean altering a
 * table that already holds rows. Etapa 9 owns the rendering and the endpoints;
 * nothing here writes rows yet.
 *
 * `dashboard_id` is `ON DELETE SET NULL` on purpose — an emitted report is a
 * historical document and must survive the deletion of the dashboard it came
 * from, with its own frozen period and channel list.
 */
@Entity('social_analytics_reports')
@Index('IDX_social_analytics_reports_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'createdAt',
])
export class SocialAnalyticsReportEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ name: 'dashboard_id', type: 'uuid', nullable: true })
  dashboardId!: string | null;

  @Column({ type: 'varchar', length: 160 }) title!: string;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  channels!: DashboardChannelId[];

  /** `date`, read back as a `YYYY-MM-DD` string — never a `Date`, which would
   * re-introduce a timezone into a calendar day. */
  @Column({ name: 'period_since', type: 'date' }) periodSince!: string;

  @Column({ name: 'period_until', type: 'date' }) periodUntil!: string;

  @Column({ name: 'page_mode', type: 'varchar', length: 16 })
  pageMode!: 'paginated' | 'continuous';

  @Column({ name: 'file_url', type: 'text', nullable: true })
  fileUrl!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
