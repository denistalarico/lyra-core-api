import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The Visão Geral title and description of one scope, shared by the LeadFlow
 * and Social Analytics (D-AN-12). The tab label stays the dashboard row's
 * `name`; only the header shown above the overview lives here.
 */
@Entity('analytics_overview_headers')
export class AnalyticsOverviewHeaderEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ type: 'varchar', length: 120 }) title!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
