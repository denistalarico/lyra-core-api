import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import type {
  LeadFlowAutomationActionConfig,
  LeadFlowAutomationConditionConfig,
  LeadFlowAutomationCrmPolicy,
  LeadFlowAutomationDeveloperConfig,
  LeadFlowAutomationMessageConfig,
  LeadFlowAutomationReadiness,
  LeadFlowAutomationSchedulePolicy,
  LeadFlowAutomationTriggerConfig,
  LeadFlowAutomationWebhookConfig,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';

/**
 * A provisioned automation instance. Recipes themselves are an in-memory
 * catalog (no table); an instance is a recipe configured for a given
 * tenant/workspace/context. Config lives in jsonb columns and is projected into
 * a predictable runtime contract — nothing here is ever executed.
 */
@Index('IDX_lf_automations_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('IDX_lf_automations_settings_id', ['settingsId'])
@Index('IDX_lf_automations_business_mode_key', ['businessModeKey'])
@Index('IDX_lf_automations_recipe_key', ['recipeKey'])
@Index('IDX_lf_automations_status', ['status'])
@Index('IDX_lf_automations_context', [
  'tenantId',
  'workspaceId',
  'contextType',
  'agencyClientId',
])
@Entity('leadflow_automations')
export class LeadFlowAutomationEntity {
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

  @Column({ name: 'recipe_key', type: 'varchar', length: 120 })
  recipeKey!: string;

  /**
   * Recipe contract version this instance was provisioned from. Lets the
   * catalog evolve without silently rewriting a published configuration — a
   * newer catalog version is surfaced to the operator, never auto-applied.
   */
  @Column({ name: 'template_version', type: 'integer', default: 1 })
  templateVersion!: number;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40 })
  category!: LeadFlowAutomationCategory;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowAutomationStatus.Draft,
  })
  status!: LeadFlowAutomationStatus;

  @Column({ name: 'trigger_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  triggerConfig!: LeadFlowAutomationTriggerConfig;

  @Column({
    name: 'condition_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  conditionConfig!: LeadFlowAutomationConditionConfig;

  @Column({ name: 'action_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  actionConfig!: LeadFlowAutomationActionConfig;

  @Column({ name: 'message_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  messageConfig!: LeadFlowAutomationMessageConfig;

  @Column({ name: 'crm_policy', type: 'jsonb', default: () => "'{}'::jsonb" })
  crmPolicy!: LeadFlowAutomationCrmPolicy;

  @Column({
    name: 'schedule_policy',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  schedulePolicy!: LeadFlowAutomationSchedulePolicy;

  @Column({
    name: 'developer_config',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  developerConfig!: LeadFlowAutomationDeveloperConfig;

  /** Holds the raw webhook secret server-side; masked on every response. */
  @Column({ name: 'webhook_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  webhookConfig!: LeadFlowAutomationWebhookConfig;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  readiness!: LeadFlowAutomationReadiness;

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
