import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { InboxScopeKind } from '../inbox-company-scope';

@Entity('inbox_settings')
@Index('idx_inbox_settings_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
export class InboxSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ name: 'scope_kind', type: 'varchar', length: 24 })
  scopeKind!: InboxScopeKind;

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
