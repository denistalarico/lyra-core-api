import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Relates roles to permission keys (blueprint section 12.3). Rows with
 * `tenantId = null` represent the system default matrix shared by every
 * tenant; tenants may override a permission by inserting a row with their
 * own `tenantId` for the same `roleId` + `permissionKey`.
 */
@Entity('platform_role_permissions')
export class PlatformRolePermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ name: 'permission_key', type: 'varchar', length: 160 })
  permissionKey!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
