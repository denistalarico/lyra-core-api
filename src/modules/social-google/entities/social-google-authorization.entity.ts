import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { GoogleAuthorizationStatus } from '../google-oauth.constants';

/**
 * One Google authorization per context and authorizing identity.
 *
 * `google_sub` is the validated OIDC subject. It is never deduplicated across
 * tenants: the same Google person connecting two agencies produces two rows
 * with independent tokens, so revoking one cannot touch the other.
 *
 * A context holds at most one non-revoked authorization (partial unique index
 * in the migration); a second Google identity must be rejected, not silently
 * mixed into the same grant.
 */
@Entity('social_google_authorizations')
@Index('IDX_social_google_authorizations_context', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
export class SocialGoogleAuthorizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ name: 'google_sub', type: 'varchar', length: 255 })
  googleSub!: string;

  @Column({ type: 'varchar', length: 24, default: 'connected' })
  status!: GoogleAuthorizationStatus;

  @Column({
    name: 'access_token_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  accessTokenEncrypted!: string | null;

  @Column({
    name: 'refresh_token_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  refreshTokenEncrypted!: string | null;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  /** Scopes Google reported as actually granted, not the ones requested. */
  @Column({ name: 'granted_scopes', type: 'text', array: true, default: '{}' })
  grantedScopes!: string[];

  @Column({ name: 'credential_version', type: 'integer', default: 1 })
  credentialVersion!: number;

  @Column({ name: 'connected_by_id', type: 'uuid', nullable: true })
  connectedById!: string | null;

  @Column({ name: 'connected_at', type: 'timestamptz' })
  connectedAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** Safe machine code only (e.g. `invalid_grant`); never provider text. */
  @Column({ name: 'last_error', type: 'varchar', length: 64, nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
