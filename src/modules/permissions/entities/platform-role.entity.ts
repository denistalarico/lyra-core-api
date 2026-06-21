import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PlatformRoleType = 'global' | 'client_product';

/**
 * Roles available to a tenant. System roles (owner/admin/manager/member) have
 * `tenantId = null` and `isSystem = true`. Tenants may define additional
 * custom roles in the future by inserting rows scoped to their own tenantId.
 */
@Entity('platform_roles')
export class PlatformRoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  key!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'role_type', type: 'varchar', length: 20, default: 'global' })
  roleType!: PlatformRoleType;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
