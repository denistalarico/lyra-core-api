import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PLATFORM_ADMIN_IDENTITY_STATUSES = [
  'pending',
  'active',
  'locked',
  'disabled',
] as const;

export type PlatformAdminIdentityStatus =
  (typeof PLATFORM_ADMIN_IDENTITY_STATUSES)[number];

@Entity('platform_admin_identities')
@Index('uq_platform_admin_identities_normalized_email', ['normalizedEmail'], {
  unique: true,
})
@Index('idx_platform_admin_identities_status', ['status'])
export class PlatformAdminIdentityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'normalized_email', type: 'varchar', length: 320 })
  normalizedEmail!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 80, nullable: true })
  jobTitle!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: PlatformAdminIdentityStatus;

  @Column({
    name: 'password_hash',
    type: 'text',
    nullable: true,
    select: false,
  })
  passwordHash!: string | null;

  @Column({
    name: 'password_configured_at',
    type: 'timestamptz',
    nullable: true,
  })
  passwordConfiguredAt!: Date | null;

  @Column({ name: 'two_factor_enabled', type: 'boolean', default: false })
  twoFactorEnabled!: boolean;

  @Column({
    name: 'two_factor_method',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  twoFactorMethod!: 'authenticator' | 'email' | null;

  @Column({
    name: 'two_factor_secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  twoFactorSecretEncrypted!: string | null;

  @Column({
    name: 'two_factor_pending_secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  twoFactorPendingSecretEncrypted!: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({
    name: 'last_password_change_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastPasswordChangeAt!: Date | null;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
