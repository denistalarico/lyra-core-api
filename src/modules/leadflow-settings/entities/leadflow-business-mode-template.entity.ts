import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import type { LeadFlowJsonObject } from '../types/leadflow-settings.types';

@Index('IDX_lf_bmt_official_key_version_unique', ['key', 'version'], {
  unique: true,
  where: 'tenant_id IS NULL',
})
@Index(
  'IDX_lf_bmt_custom_tenant_key_version_unique',
  ['tenantId', 'key', 'version'],
  {
    unique: true,
    where: 'tenant_id IS NOT NULL',
  },
)
@Index('IDX_lf_bmt_tenant_id', ['tenantId'])
@Index('IDX_lf_bmt_status', ['status'])
@Index('IDX_lf_bmt_is_official', ['isOfficial'])
@Index('IDX_lf_bmt_key', ['key'])
@Entity('leadflow_business_mode_templates')
export class LeadFlowBusinessModeTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 80 })
  key!: LeadFlowBusinessMode;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({
    type: 'varchar',
    length: 30,
    default: LeadFlowSettingsStatus.Active,
  })
  status!: LeadFlowSettingsStatus;

  @Column({ name: 'is_official', type: 'boolean', default: true })
  isOfficial!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem!: boolean;

  @Column({ name: 'is_developer_only', type: 'boolean', default: false })
  isDeveloperOnly!: boolean;

  @Column({ name: 'parent_template_id', type: 'uuid', nullable: true })
  parentTemplateId!: string | null;

  @Column({
    name: 'pipeline_template',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  pipelineTemplate!: LeadFlowJsonObject;

  @Column({
    name: 'conversion_goals',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  conversionGoals!: LeadFlowJsonObject;

  @Column({
    name: 'qualification_fields',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  qualificationFields!: LeadFlowJsonObject[];

  @Column({
    name: 'agent_prompt_template',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  agentPromptTemplate!: LeadFlowJsonObject;

  @Column({
    name: 'client_prompt_schema',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  clientPromptSchema!: LeadFlowJsonObject;

  @Column({ name: 'inbox_rules', type: 'jsonb', default: () => "'{}'::jsonb" })
  inboxRules!: LeadFlowJsonObject;

  @Column({
    name: 'handoff_rules',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  handoffRules!: LeadFlowJsonObject;

  @Column({
    name: 'recommended_apps',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  recommendedApps!: LeadFlowJsonObject[];

  @Column({
    name: 'supported_integrations',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  supportedIntegrations!: LeadFlowJsonObject;

  @Column({
    name: 'developer_overrides_schema',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  developerOverridesSchema!: LeadFlowJsonObject;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: LeadFlowJsonObject;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
