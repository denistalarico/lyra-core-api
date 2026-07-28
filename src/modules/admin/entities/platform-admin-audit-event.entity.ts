import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PlatformAdminAuditOutcome = 'success' | 'denied' | 'failure';

@Entity('platform_admin_audit_events')
@Index('idx_platform_admin_audit_actor_created', ['actorAdminId', 'createdAt'])
@Index('idx_platform_admin_audit_action_created', ['action', 'createdAt'])
export class PlatformAdminAuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_admin_id', type: 'uuid', nullable: true })
  actorAdminId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 80, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'varchar', length: 160, nullable: true })
  targetId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  outcome!: PlatformAdminAuditOutcome;

  @Column({ name: 'ip_address', type: 'varchar', length: 120, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
