import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ClientAreaInvitationStatus,
  ClientAreaRole,
} from '../client-area.types';

/**
 * CA2 — invitation of one email to one Company Context of the Client Area.
 *
 * Only `sha256(token)` is stored; the plaintext token exists once, in the
 * email. The row is the single authority for company, role and email at
 * acceptance — the request only proves possession of the token.
 *
 * Never deleted and never reused: acceptance, revocation and resend flip the
 * status (resend revokes this row and points `superseded_by_invitation_id` at
 * the new one). At most one `pending` row per (company, normalized email).
 */
@Entity('client_area_invitations')
@Index('UQ_client_area_invitations_token_hash', ['tokenHash'], {
  unique: true,
})
@Index(
  'UQ_client_area_invitations_pending',
  ['companyContextId', 'emailNormalized'],
  { unique: true, where: `"status" = 'pending'` },
)
@Index('IDX_client_area_invitations_company', [
  'tenantId',
  'workspaceId',
  'companyContextId',
  'status',
])
export class ClientAreaInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid' })
  agencyClientId!: string;

  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;

  /** As typed by the Agency operator (trimmed), for display. */
  @Column({ type: 'varchar', length: 160 })
  email!: string;

  /** `lower(btrim(email))` — the lookup key; enforced by a CHECK. */
  @Column({ name: 'email_normalized', type: 'varchar', length: 160 })
  emailNormalized!: string;

  @Column({ type: 'varchar', length: 24 })
  role!: ClientAreaRole;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: ClientAreaInvitationStatus;

  @Column({ name: 'invited_by_user_id', type: 'uuid' })
  invitedByUserId!: string;

  @Column({ name: 'accepted_user_id', type: 'uuid', nullable: true })
  acceptedUserId!: string | null;

  @Column({ name: 'accepted_membership_id', type: 'uuid', nullable: true })
  acceptedMembershipId!: string | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  revokedByUserId!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({
    name: 'superseded_by_invitation_id',
    type: 'uuid',
    nullable: true,
  })
  supersededByInvitationId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
