import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type WebchatWidgetStatus = 'draft' | 'active' | 'inactive';
export type WebchatWidgetPosition = 'bottom-right' | 'bottom-left';
export type WebchatLeadCaptureMode = 'before_chat' | 'during_chat' | 'optional';

@Entity('webchat_widgets')
@Index('idx_webchat_widgets_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_webchat_widgets_public_key', ['publicKey'], { unique: true })
@Index('idx_webchat_widgets_status', ['tenantId', 'workspaceId', 'status'])
export class WebchatWidgetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'varchar', length: 160 })
  slug!: string;

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status!: WebchatWidgetStatus;

  @Column({ name: 'public_key', type: 'uuid' })
  @Generated('uuid')
  publicKey!: string;

  @Column({ name: 'allowed_domains', type: 'jsonb', default: () => "'[]'::jsonb" })
  allowedDomains!: string[];

  @Column({ type: 'varchar', length: 120, default: 'Olá! Como podemos ajudar?' })
  title!: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  subtitle!: string | null;

  @Column({
    name: 'initial_message',
    type: 'text',
    nullable: true,
  })
  initialMessage!: string | null;

  @Column({ name: 'primary_color', type: 'varchar', length: 24, default: '#2563EB' })
  primaryColor!: string;

  @Column({ type: 'varchar', length: 32, default: 'bottom-right' })
  position!: WebchatWidgetPosition;

  @Column({ name: 'default_locale', type: 'varchar', length: 16, default: 'pt-BR' })
  defaultLocale!: string;

  @Column({ name: 'ai_enabled', type: 'boolean', default: false })
  aiEnabled!: boolean;

  @Column({ name: 'default_agent_id', type: 'uuid', nullable: true })
  defaultAgentId!: string | null;

  @Column({ name: 'agent_display_name', type: 'varchar', length: 120, nullable: true })
  agentDisplayName!: string | null;

  @Column({ name: 'agent_avatar_url', type: 'text', nullable: true })
  agentAvatarUrl!: string | null;

  @Column({ name: 'brand_footer_enabled', type: 'boolean', default: true })
  brandFooterEnabled!: boolean;

  @Column({
    name: 'brand_footer_text',
    type: 'varchar',
    length: 180,
    default: 'By Lyra Suite',
  })
  brandFooterText!: string;

  @Column({ name: 'lead_capture_enabled', type: 'boolean', default: false })
  leadCaptureEnabled!: boolean;

  @Column({ name: 'lead_capture_mode', type: 'varchar', length: 32, default: 'optional' })
  leadCaptureMode!: WebchatLeadCaptureMode;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
