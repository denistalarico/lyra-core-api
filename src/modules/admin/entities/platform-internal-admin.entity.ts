import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PlatformAdminRoleKey,
  PlatformAdminStatus,
} from '../types/admin-access.types';

/**
 * The Agency identity reference is intentionally logical. No foreign key is
 * declared so the identity can move to a central store without coupling the
 * administrative authorization record to Agency tables.
 */
@Entity('platform_internal_admins')
@Unique('uq_platform_internal_admins_identity', ['identityTenantId', 'userId'])
@Index('idx_platform_internal_admins_status', ['status'])
export class PlatformInternalAdminEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'identity_tenant_id', type: 'uuid' })
  identityTenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: PlatformAdminStatus;

  @Column({ name: 'role_key', type: 'varchar', length: 40 })
  roleKey!: PlatformAdminRoleKey;

  @Column({ name: 'two_factor_required', type: 'boolean', default: true })
  twoFactorRequired!: boolean;

  @Column({ type: 'varchar', length: 10, default: 'pt-BR' })
  locale!: string;

  @Column({ type: 'varchar', length: 20, default: 'system' })
  theme!: string;

  @Column({ type: 'varchar', length: 80, default: 'America/Sao_Paulo' })
  timezone!: string;

  @Column({
    name: 'date_format',
    type: 'varchar',
    length: 20,
    default: 'dd/MM/yyyy',
  })
  dateFormat!: string;

  @Column({ name: 'time_format', type: 'varchar', length: 10, default: '24h' })
  timeFormat!: '12h' | '24h';

  @Column({
    name: 'last_admin_login_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastAdminLoginAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
