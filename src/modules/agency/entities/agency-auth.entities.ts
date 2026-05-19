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
@Unique('uq_agency_user_security_settings_tenant_user', ['tenantId', 'userId'])
@Index('idx_agency_user_security_settings_tenant_user', ['tenantId', 'userId'])
export class AgencyUserSecuritySettingsEntity {
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

@Entity('user_sessions')
@Index('idx_agency_user_sessions_tenant_user', ['tenantId', 'userId'])
export class AgencyUserSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'session_token_hash', type: 'text', nullable: true })
  sessionTokenHash!: string | null;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 120 })
  browser!: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 120, nullable: true })
  ipAddress!: string | null;

  @Column({
    name: 'device_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  deviceFingerprint!: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true })
  deviceName!: string | null;

  @Column({ type: 'varchar', length: 120, default: '' })
  location!: string;

  @Column({ name: 'last_seen', type: 'varchar', length: 120, default: '' })
  lastSeen!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'current' | 'active' | 'expired';

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('user_trusted_devices')
@Index('idx_agency_user_trusted_devices_tenant_user', ['tenantId', 'userId'])
export class AgencyUserTrustedDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'device_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  deviceFingerprint!: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true })
  deviceName!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 120, nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location!: string | null;

  @Column({ name: 'trusted_at', type: 'timestamptz', nullable: true })
  trustedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('password_resets')
@Index('idx_agency_password_resets_token_hash', ['tokenHash'])
@Index('idx_agency_password_resets_tenant_user', ['tenantId', 'userId'])
export class AgencyPasswordResetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('auth_email_2fa_codes')
@Index('idx_agency_auth_email_2fa_codes_tenant_user_purpose', [
  'tenantId',
  'userId',
  'purpose',
])
export class AgencyEmailTwoFactorCodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'code_hash', type: 'text' })
  codeHash!: string;

  @Column({ type: 'varchar', length: 20, default: 'login' })
  purpose!: 'login' | 'setup';

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
