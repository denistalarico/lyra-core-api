import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('webchat_visitors')
@Index('idx_webchat_visitors_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_webchat_visitors_widget', ['widgetId'])
@Index('idx_webchat_visitors_anonymous', ['widgetId', 'anonymousId'])
@Index('idx_webchat_visitors_contact', ['contactId'])
export class WebchatVisitorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'widget_id', type: 'uuid' })
  widgetId!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'anonymous_id', type: 'varchar', length: 160 })
  anonymousId!: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone!: string | null;

  @Column({ name: 'ip_hash', type: 'varchar', length: 128, nullable: true })
  ipHash!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  locale!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'first_seen_at', type: 'timestamptz', nullable: true })
  firstSeenAt!: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
