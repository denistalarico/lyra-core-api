import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PermissionRiskLevel } from '../enums/permission.enums';

/**
 * Global catalog of permission keys (blueprint section 12.2). This table is
 * not tenant-scoped: it describes every capability the platform knows about.
 */
@Entity('platform_permissions')
export class PlatformPermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160, unique: true })
  key!: string;

  @Column({ name: 'product_key', type: 'varchar', length: 30 })
  productKey!: string;

  @Column({ name: 'module_key', type: 'varchar', length: 60 })
  moduleKey!: string;

  @Column({ name: 'resource_key', type: 'varchar', length: 120 })
  resourceKey!: string;

  @Column({ name: 'action_key', type: 'varchar', length: 60 })
  actionKey!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 60, nullable: true })
  scopeKey!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'risk_level', type: 'varchar', length: 20, default: PermissionRiskLevel.Low })
  riskLevel!: PermissionRiskLevel;

  @Column({ name: 'is_dangerous', type: 'boolean', default: false })
  isDangerous!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
