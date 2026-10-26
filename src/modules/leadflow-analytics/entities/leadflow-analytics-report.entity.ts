import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { DashboardChannelId } from '../dashboards/dashboard-layout.contract';

/**
 * A report emitted from a LeadFlow dashboard (aba Relatórios, AN-LF2).
 *
 * The same shape as `social_analytics_reports`, in a table of its own: each
 * product keeps its archive, its permissions and its retention, and only the
 * rendering is shared (`modules/analytics-reports`).
 *
 * `dashboard_id` is `ON DELETE SET NULL` on purpose — an emitted report is a
 * historical document and must survive the deletion of the dashboard it came
 * from, with its own frozen period and channel list.
 */
@Entity('leadflow_analytics_reports')
@Index('IDX_leadflow_analytics_reports_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'createdAt',
])
export class LeadFlowAnalyticsReportEntity {
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

  /** Private-object key. A report is never stored in the public asset bucket. */
  @Column({ name: 'storage_key', type: 'text', nullable: true })
  storageKey!: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 180, nullable: true })
  fileName!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  /** Immutable display label, so an archived emission remains understandable. */
  @Column({
    name: 'issued_by_name',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  issuedByName!: string | null;

  /** IANA zone of the browser that issued the document. */
  @Column({
    name: 'issued_timezone',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  issuedTimezone!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
