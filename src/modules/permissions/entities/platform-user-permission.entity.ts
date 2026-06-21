import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Direct per-user permission overrides (blueprint section 12.4), used for
 * exceptions such as granting a finance permission to a specific user or
 * temporarily revoking a permission from a role member.
 */
@Entity('platform_user_permissions')
@Index('idx_platform_user_permissions_tenant_user', ['tenantId', 'userId'])
export class PlatformUserPermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'permission_key', type: 'varchar', length: 160 })
  permissionKey!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'scope_type', type: 'varchar', length: 30, nullable: true })
  scopeType!: string | null;

  @Column({ name: 'scope_id', type: 'uuid', nullable: true })
  scopeId!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
