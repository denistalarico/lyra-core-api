import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Ad account connections used by Lyra Social.
 *
 * Deliberately *not* `inbox_channels`. The two share a credential vocabulary
 * (`*_encrypted`, `credential_version`, `connection_status`) because that
 * vocabulary is correct, not because they share a domain: an inbox channel is
 * bound to conversations, webhooks and a page identity, none of which mean
 * anything for a spend report. Reusing that table would make every future Ads
 * column a change to the messaging schema.
 *
 * This is not "the Integrations Layer" either. With a single provider,
 * extracting a generic credential store would be abstraction ahead of
 * evidence. The second provider is the moment to revisit it.
 */
export type SocialAdProvider = 'meta_ads' | 'google_ads';

/**
 * Lifecycle of one connection attempt, from the OAuth redirect to a live
 * account.
 *
 * The in-progress states live here rather than in a separate session table on
 * purpose: "connecting" and "waiting for account selection" are states *of a
 * connection*, and the settings screen has to render them as such. A parallel
 * session table would duplicate the tenant/workspace/client scope and force
 * every read to union two sources.
 */
export type SocialAdConnectionStatus =
  | 'pending'
  | 'awaiting_selection'
  | 'connected'
  | 'error'
  | 'disconnected';

/**
 * How the credential behind a connection was obtained.
 *
 * This is a column rather than a metadata key because it decides real
 * behaviour: a `business_login` row reads its token from
 * `access_token_encrypted`, while an `internal_system_user` row has no stored
 * token at all and reads it from server configuration. Anything that resolves
 * a credential has to branch on this, and a branch that depends on an
 * unconstrained JSON key is one typo away from silently taking the wrong
 * path.
 *
 * `internal_system_user` is an exception for the tenant that owns the Meta App
 * itself — an app's owner cannot select its own Business Manager through
 * Facebook Login for Business. Every other tenant uses `business_login`.
 */
export type SocialAdAuthorizationMethod =
  | 'business_login'
  | 'internal_system_user';

@Entity('social_ad_account_connections')
// NULL external_account_id is distinct in Postgres, so in-flight rows never
// collide with each other — the constraint only binds once an account is
// actually chosen, which is exactly when duplication becomes meaningful.
@Unique('UQ_social_ad_account_connections_account', [
  'tenantId',
  'workspaceId',
  'provider',
  'externalAccountId',
])
@Index('IDX_social_ad_account_connections_context', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_ad_account_connections_oauth_state', ['oauthStateHash'])
export class SocialAdAccountConnectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** Managed client this account belongs to. NULL means the agency's own account. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  provider!: SocialAdProvider;

  /**
   * Defaults to `business_login` so every existing row keeps the meaning it
   * already had, and so a row created without naming a method can never
   * accidentally claim the internal one.
   */
  @Column({
    name: 'authorization_method',
    type: 'varchar',
    length: 40,
    default: 'business_login',
  })
  authorizationMethod!: SocialAdAuthorizationMethod;

  /** Provider-side ad account id. NULL only while the connection is in flight. */
  @Column({
    name: 'external_account_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalAccountId!: string | null;

  @Column({
    name: 'external_business_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalBusinessId!: string | null;

  @Column({
    name: 'account_name',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  accountName!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  @Column({
    name: 'connection_status',
    type: 'varchar',
    length: 32,
    default: 'pending',
  })
  connectionStatus!: SocialAdConnectionStatus;

  @Column({ name: 'credential_version', type: 'integer', default: 1 })
  credentialVersion!: number;

  /**
   * `select: false` is the second line of defense behind the response view:
   * a query that forgets to exclude the token simply does not load it, and a
   * new endpoint cannot leak a credential by returning the raw entity.
   */
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

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  scopes!: string[];

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt!: Date | null;

  /** Safe error code, never a provider message that could carry identifiers. */
  @Column({
    name: 'last_sync_error',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  lastSyncError!: string | null;

  /**
   * Hashed OAuth state for the in-flight authorization. Stored hashed for the
   * same reason the Inbox does it: the callback arrives on a public URL, and a
   * database read must not hand anyone a usable state value.
   */
  @Column({
    name: 'oauth_state_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  oauthStateHash!: string | null;

  /**
   * Deadline for the whole in-flight authorization — the provider round trip
   * *and* the account selection that follows it. Set once when the attempt
   * starts and never extended, so "how long is this row still usable" has a
   * single unambiguous answer that both the callback and the selection read.
   *
   * It is also the marker for abandoned attempts:
   *   `external_account_id IS NULL AND oauth_expires_at < now()`
   * is exactly the set that never became a connection and never will. Today
   * those rows are deleted opportunistically, when the same scope starts a new
   * attempt (`discardInFlightConnections`), and hidden from every read in the
   * meantime. TODO(social-s2): sweep them on a schedule as well, so a scope
   * that abandons an attempt and never retries does not keep the row forever.
   */
  @Column({ name: 'oauth_expires_at', type: 'timestamptz', nullable: true })
  oauthExpiresAt!: Date | null;

  /** User who started the connection. Used to scope the selection step. */
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  /**
   * Non-credential provider context only: discovered accounts awaiting
   * selection, account status, business name. Never a token — the token has
   * its own encrypted column, and metadata is not encrypted.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  /** Set on disconnect. A row with this set holds no usable credential. */
  @Column({
    name: 'credential_removed_at',
    type: 'timestamptz',
    nullable: true,
  })
  credentialRemovedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
