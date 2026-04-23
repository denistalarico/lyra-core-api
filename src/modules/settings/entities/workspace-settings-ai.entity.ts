// src/modules/settings/entities/workspace-settings-ai.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workspace_settings_ai')
@Unique('uq_workspace_settings_ai_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_workspace_settings_ai_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class WorkspaceSettingsAiEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'default_agent_language',
    type: 'varchar',
    length: 10,
    default: 'pt-BR',
  })
  defaultAgentLanguage!: 'pt-BR' | 'en' | 'es';

  @Column({
    name: 'default_tone',
    type: 'varchar',
    length: 20,
    default: 'professional',
  })
  defaultTone!: 'professional' | 'friendly' | 'consultative' | 'direct';

  @Column({ name: 'enable_suggestions', type: 'boolean', default: true })
  enableSuggestions!: boolean;

  @Column({ name: 'enable_autofill', type: 'boolean', default: true })
  enableAutofill!: boolean;

  @Column({ name: 'enable_auto_summaries', type: 'boolean', default: true })
  enableAutoSummaries!: boolean;

  @Column({
    name: 'enable_contextual_suggestions',
    type: 'boolean',
    default: true,
  })
  enableContextualSuggestions!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
