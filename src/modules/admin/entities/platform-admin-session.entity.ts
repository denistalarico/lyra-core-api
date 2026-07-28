import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PLATFORM_ADMIN_SESSION_STATUSES = [
  'active',
  'expired',
  'revoked',
] as const;

export type PlatformAdminSessionStatus =
  (typeof PLATFORM_ADMIN_SESSION_STATUSES)[number];

@Entity('platform_admin_sessions')
@Index('idx_platform_admin_sessions_admin_id', ['adminId'])
@Index('idx_platform_admin_sessions_user_id', ['userId'])
@Index('idx_platform_admin_sessions_platform_identity', [
  'platformAdminIdentityId',
])
@Index('idx_platform_admin_sessions_refresh_token_hash', ['refreshTokenHash'])
@Index('idx_platform_admin_sessions_status', ['status'])
@Index('idx_platform_admin_sessions_expires_at', ['expiresAt'])
export class PlatformAdminSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'admin_id', type: 'uuid' })
  adminId!: string;

  @Column({ name: 'identity_source', type: 'varchar', length: 30 })
  identitySource?: 'agency' | 'platform_admin';

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'identity_tenant_id', type: 'uuid', nullable: true })
  identityTenantId!: string | null;

  @Column({
    name: 'platform_admin_identity_id',
    type: 'uuid',
    nullable: true,
  })
  platformAdminIdentityId?: string | null;

  @Column({ name: 'refresh_token_hash', type: 'text' })
  refreshTokenHash!: string;

  @Column({
    name: 'previous_refresh_token_hash',
    type: 'text',
    nullable: true,
  })
  previousRefreshTokenHash!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: PlatformAdminSessionStatus;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 120 })
  browser!: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({
    name: 'accept_language',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  acceptLanguage!: string | null;

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

  @Column({ type: 'varchar', length: 120, nullable: true })
  location!: string | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
