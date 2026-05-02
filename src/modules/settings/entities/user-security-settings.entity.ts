import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_security_settings')
@Unique('uq_user_security_settings_tenant_user', ['tenantId', 'userId'])
@Index('idx_user_security_settings_tenant_user', ['tenantId', 'userId'])
export class UserSecuritySettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'current_email', type: 'varchar', length: 160, default: '' })
  currentEmail!: string;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'password_updated_at', type: 'timestamptz', nullable: true })
  passwordUpdatedAt!: Date | null;

  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  twoFactorEnabled!: boolean;

  @Column({
    name: 'two_factor_method',
    type: 'varchar',
    length: 20,
    default: 'authenticator',
  })
  twoFactorMethod!: 'authenticator' | 'email';

  @Column({ name: 'two_factor_secret_encrypted', type: 'text', nullable: true })
  twoFactorSecretEncrypted!: string | null;

  @Column({
    name: 'two_factor_pending_secret_encrypted',
    type: 'text',
    nullable: true,
  })
  twoFactorPendingSecretEncrypted!: string | null;

  @Column({ name: 'login_alerts_enabled', type: 'boolean', default: true })
  loginAlertsEnabled!: boolean;

  @Column({ name: 'trusted_devices_enabled', type: 'boolean', default: true })
  trustedDevicesEnabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
