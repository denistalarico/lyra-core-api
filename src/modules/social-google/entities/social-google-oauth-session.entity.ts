import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  GoogleOAuthSessionStatus,
  GoogleProduct,
} from '../google-oauth.constants';

/**
 * In-flight authorization attempt.
 *
 * The context, initiating user and product are fixed here when the attempt
 * starts; the public callback only supplies `state`, never context. The
 * tokens from the code exchange wait here (encrypted) until the same
 * authenticated user confirms, so the unauthenticated callback never writes a
 * credential into a tenant's live authorization.
 */
@Entity('social_google_oauth_sessions')
@Index('UQ_social_google_oauth_sessions_state', ['stateHash'], { unique: true })
export class SocialGoogleOAuthSessionEntity {
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

  @Column({ name: 'initiated_by_id', type: 'uuid' })
  initiatedById!: string;

  @Column({ type: 'varchar', length: 24 })
  product!: GoogleProduct;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: GoogleOAuthSessionStatus;

  @Column({ name: 'state_hash', type: 'varchar', length: 64 })
  stateHash!: string;

  /** PKCE verifier, encrypted; cleared when the state is consumed. */
  @Column({
    name: 'code_verifier_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  codeVerifierEncrypted!: string | null;

  @Column({ name: 'nonce_hash', type: 'varchar', length: 64 })
  nonceHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'google_sub', type: 'varchar', length: 255, nullable: true })
  googleSub!: string | null;

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

  @Column({ name: 'granted_scopes', type: 'text', array: true, default: '{}' })
  grantedScopes!: string[];

  @Column({
    name: 'failure_reason',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  failureReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
