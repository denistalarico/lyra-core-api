import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PermissionAuditAction, PermissionRiskLevel } from '../enums/permission.enums';

/**
 * Audit trail for sensitive permission/security related actions
 * (blueprint sections 12.7 and 18).
 */
@Entity('platform_permission_audit_events')
@Index('idx_platform_permission_audit_tenant_created', ['tenantId', 'createdAt'])
export class PlatformPermissionAuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId!: string | null;

  @Column({ type: 'varchar', length: 60 })
  action!: PermissionAuditAction | string;

  @Column({ name: 'permission_key', type: 'varchar', length: 160, nullable: true })
  permissionKey!: string | null;

  @Column({ name: 'resource_type', type: 'varchar', length: 80, nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'risk_level', type: 'varchar', length: 20, nullable: true })
  riskLevel!: PermissionRiskLevel | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
