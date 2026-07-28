import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PlatformAdminRoleKey } from '../types/admin-access.types';

export const PLATFORM_ADMIN_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'expired',
  'cancelled',
] as const;

export type PlatformAdminInvitationStatus =
  (typeof PLATFORM_ADMIN_INVITATION_STATUSES)[number];

@Entity('platform_admin_invitations')
@Index('idx_platform_admin_invitations_email', ['normalizedEmail'])
@Index('idx_platform_admin_invitations_status', ['status'])
@Index('idx_platform_admin_invitations_expires_at', ['expiresAt'])
@Index('uq_platform_admin_invitations_token_hash', ['tokenHash'], {
  unique: true,
})
export class PlatformAdminInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'normalized_email', type: 'varchar', length: 320 })
  normalizedEmail!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 40 })
  roleKey!: PlatformAdminRoleKey;

  @Column({ type: 'varchar', length: 20 })
  status!: PlatformAdminInvitationStatus;

  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'invited_by_admin_id', type: 'uuid' })
  invitedByAdminId!: string;

  @Column({ name: 'accepted_by_user_id', type: 'uuid', nullable: true })
  acceptedByUserId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
