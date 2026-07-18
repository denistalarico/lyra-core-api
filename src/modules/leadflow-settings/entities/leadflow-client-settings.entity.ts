import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import type {
  LeadFlowEnabledAppsConfig,
  LeadFlowEnabledIntegrationsConfig,
  LeadFlowJsonObject,
} from '../types/leadflow-settings.types';

@Index(
  'IDX_lf_client_settings_unique_agency_context',
  ['tenantId', 'workspaceId'],
  {
    unique: true,
    where: "context_type = 'agency'",
  },
)
@Index(
  'IDX_lf_client_settings_unique_client_context',
  ['tenantId', 'workspaceId', 'agencyClientId'],
  {
    unique: true,
    where: "context_type = 'client'",
  },
)
@Index('IDX_lf_client_settings_context_type', ['contextType'])
@Index('IDX_lf_client_settings_managed_tenant_id', ['managedTenantId'])
@Index('IDX_lf_client_settings_business_mode_key', ['businessModeKey'])
@Index('IDX_lf_client_settings_template_id', ['businessModeTemplateId'])
@Index('IDX_lf_client_settings_status', ['status'])
@Index('IDX_lf_client_settings_tenant_workspace', ['tenantId', 'workspaceId'])
@Entity('leadflow_client_settings')
export class LeadFlowClientSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'context_type',
    type: 'varchar',
    length: 30,
    default: LeadFlowSettingsContextType.Client,
  })
  contextType!: LeadFlowSettingsContextType;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'managed_tenant_id', type: 'uuid', nullable: true })
  managedTenantId!: string | null;

  @Column({ name: 'business_mode_key', type: 'varchar', length: 80 })
  businessModeKey!: LeadFlowBusinessMode;

  @Column({ name: 'business_mode_template_id', type: 'uuid', nullable: true })
  businessModeTemplateId!: string | null;

  @Column({ name: 'plan_key', type: 'varchar', length: 80, nullable: true })
  planKey!: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowSettingsStatus.Draft,
  })
  status!: LeadFlowSettingsStatus;

  @Column({
    name: 'developer_mode_enabled',
    type: 'boolean',
    default: false,
  })
  developerModeEnabled!: boolean;

  @Column({ name: 'enabled_apps', type: 'jsonb', default: () => "'{}'::jsonb" })
  enabledApps!: LeadFlowEnabledAppsConfig;

  @Column({
    name: 'enabled_integrations',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  enabledIntegrations!: LeadFlowEnabledIntegrationsConfig;

  @Column({
    name: 'permissions_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  permissionsConfig!: LeadFlowJsonObject;

  @Column({
    name: 'branding_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  brandingConfig!: LeadFlowJsonObject;

  @Column({ name: 'agent_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  agentConfig!: LeadFlowJsonObject;

  @Column({
    name: 'client_prompt_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  clientPromptConfig!: LeadFlowJsonObject;

  @Column({ name: 'company_context_schema_version', type: 'int', default: 1 })
  companyContextSchemaVersion!: number;
  @Column({
    name: 'company_context_draft',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  companyContextDraft!: LeadFlowJsonObject;
  @Column({
    name: 'company_context_published',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  companyContextPublished!: LeadFlowJsonObject;
  @Column({
    name: 'company_context_published_version',
    type: 'int',
    default: 0,
  })
  companyContextPublishedVersion!: number;
  @Column({
    name: 'company_context_published_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  companyContextPublishedHash!: string | null;
  @Column({
    name: 'company_context_published_at',
    type: 'timestamptz',
    nullable: true,
  })
  companyContextPublishedAt!: Date | null;
  @Column({
    name: 'company_context_published_by',
    type: 'uuid',
    nullable: true,
  })
  companyContextPublishedBy!: string | null;

  @Column({ name: 'inbox_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  inboxConfig!: LeadFlowJsonObject;

  @Column({
    name: 'inbox_overrides',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  inboxOverrides!: LeadFlowJsonObject;

  @Column({
    name: 'handoff_overrides',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  handoffOverrides!: LeadFlowJsonObject;

  @Column({ name: 'leads_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  leadsConfig!: LeadFlowJsonObject;

  @Column({ name: 'pipeline_ref', type: 'jsonb', default: () => "'{}'::jsonb" })
  pipelineRef!: LeadFlowJsonObject;

  @Column({
    name: 'business_mode_overrides',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  businessModeOverrides!: LeadFlowJsonObject;

  @Column({
    name: 'developer_overrides',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  developerOverrides!: LeadFlowJsonObject;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: LeadFlowJsonObject;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
