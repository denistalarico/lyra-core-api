import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import type {
  LeadFlowAgentAvatarConfig,
  LeadFlowAgentBehaviorConfig,
  LeadFlowAgentChannelPolicy,
  LeadFlowAgentCrmPolicy,
  LeadFlowAgentHandoffPolicy,
  LeadFlowAgentPromptConfig,
  LeadFlowAgentReadiness,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';

@Index('IDX_lf_agents_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('IDX_lf_agents_settings_id', ['settingsId'])
@Index('IDX_lf_agents_business_mode_key', ['businessModeKey'])
@Index('IDX_lf_agents_status', ['status'])
@Index('IDX_lf_agents_context', ['tenantId', 'workspaceId', 'contextType', 'agencyClientId'])
@Entity('leadflow_agents')
export class LeadFlowAgentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid', nullable: true })
  settingsId!: string | null;

  @Column({
    name: 'context_type',
    type: 'varchar',
    length: 30,
    default: LeadFlowSettingsContextType.Agency,
  })
  contextType!: LeadFlowSettingsContextType;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /** Snapshot of the active Business Mode inherited from LeadFlow Settings. */
  @Column({ name: 'business_mode_key', type: 'varchar', length: 80 })
  businessModeKey!: string;

  @Column({ name: 'preset_key', type: 'varchar', length: 120, nullable: true })
  presetKey!: string | null;

  @Column({ type: 'varchar', length: 60, default: LeadFlowAgentType.Custom })
  type!: LeadFlowAgentType;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowAgentStatus.Draft,
  })
  status!: LeadFlowAgentStatus;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_custom', type: 'boolean', default: false })
  isCustom!: boolean;

  @Column({ name: 'is_protected', type: 'boolean', default: false })
  isProtected!: boolean;

  @Column({
    name: 'behavior_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  behaviorConfig!: LeadFlowAgentBehaviorConfig;

  @Column({ name: 'prompt_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  promptConfig!: LeadFlowAgentPromptConfig;

  @Column({ name: 'handoff_policy', type: 'jsonb', default: () => "'{}'::jsonb" })
  handoffPolicy!: LeadFlowAgentHandoffPolicy;

  @Column({ name: 'crm_policy', type: 'jsonb', default: () => "'{}'::jsonb" })
  crmPolicy!: LeadFlowAgentCrmPolicy;

  @Column({ name: 'channel_policy', type: 'jsonb', default: () => "'{}'::jsonb" })
  channelPolicy!: LeadFlowAgentChannelPolicy;

  @Column({ name: 'avatar_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  avatarConfig!: LeadFlowAgentAvatarConfig;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  readiness!: LeadFlowAgentReadiness;

  @Column({ name: 'published_version_id', type: 'uuid', nullable: true })
  publishedVersionId!: string | null;

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
