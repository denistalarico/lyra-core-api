import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type { LeadFlowAnalyticsReportType } from '../dto/create-analytics-report.dto';

@Index('IDX_lf_analytics_views_scope_user', [
  'tenantId',
  'workspaceId',
  'contextType',
  'agencyClientId',
  'userId',
])
@Entity('leadflow_analytics_views')
export class LeadFlowAnalyticsViewEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'context_type', type: 'varchar', length: 30 })
  contextType!: LeadFlowSettingsContextType;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ name: 'schema_version', type: 'smallint', default: 1 })
  schemaVersion!: number;

  @Column({ name: 'report_type', type: 'varchar', length: 24 })
  reportType!: LeadFlowAnalyticsReportType;

  @Column({ name: 'period_from', type: 'date' })
  from!: string;

  @Column({ name: 'period_to', type: 'date' })
  to!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({
    name: 'business_mode',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  businessMode!: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ name: 'widget_order', type: 'jsonb', default: () => "'[]'::jsonb" })
  widgetOrder!: string[];

  @Column({
    name: 'hidden_widget_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  hiddenWidgetIds!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
