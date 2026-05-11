import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('inbox_settings')
@Index('idx_inbox_settings_tenant_workspace', ['tenantId', 'workspaceId'], {
  unique: true,
})
export class InboxSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  tags!: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  channels!: Array<Record<string, unknown>>;

  @Column({ name: 'ai_assignment_rules', type: 'jsonb', default: () => "'[]'::jsonb" })
  aiAssignmentRules!: Array<Record<string, unknown>>;

  @Column({ name: 'human_assignment_rules', type: 'jsonb', default: () => "'[]'::jsonb" })
  humanAssignmentRules!: Array<Record<string, unknown>>;

  @Column({ name: 'notification_settings', type: 'jsonb', default: () => "'{}'::jsonb" })
  notificationSettings!: Record<string, unknown>;

  @Column({ name: 'business_hours', type: 'jsonb', default: () => "'{}'::jsonb" })
  businessHours!: Record<string, unknown>;

  @Column({ name: 'conversation_automations', type: 'jsonb', default: () => "'[]'::jsonb" })
  conversationAutomations!: Array<Record<string, unknown>>;

  @Column({ name: 'quick_replies', type: 'jsonb', default: () => "'[]'::jsonb" })
  quickReplies!: Array<Record<string, unknown>>;

  @Column({ name: 'lead_rules', type: 'jsonb', default: () => "'[]'::jsonb" })
  leadRules!: Array<Record<string, unknown>>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
