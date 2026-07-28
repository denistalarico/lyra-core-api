import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const PLATFORM_ADMIN_IDENTITY_TOKEN_PURPOSES = [
  'initial_password_setup',
  'password_reset',
  'two_factor_recovery',
  'email_verification',
] as const;

export type PlatformAdminIdentityTokenPurpose =
  (typeof PLATFORM_ADMIN_IDENTITY_TOKEN_PURPOSES)[number];

@Entity('platform_admin_identity_tokens')
@Index('uq_platform_admin_identity_tokens_hash', ['tokenHash'], {
  unique: true,
})
@Index('idx_platform_admin_identity_tokens_identity_purpose', [
  'identityId',
  'purpose',
])
@Index('idx_platform_admin_identity_tokens_expires_at', ['expiresAt'])
export class PlatformAdminIdentityTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'identity_id', type: 'uuid' })
  identityId!: string;

  @Column({ type: 'varchar', length: 40 })
  purpose!: PlatformAdminIdentityTokenPurpose;

  @Column({ name: 'token_hash', type: 'varchar', length: 128, select: false })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
