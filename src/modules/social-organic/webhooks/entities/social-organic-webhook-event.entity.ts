import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialOrganicWebhookEventStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'unhandled'
  | 'failed'
  | 'dead_letter';

export type SocialOrganicWebhookScopeResolution =
  | 'resolved'
  | 'unresolved_unknown_asset'
  | 'unresolved_ambiguous'
  | 'unresolved_no_asset_id';

/**
 * Durable receipt for one signature-verified organic webhook delivery.
 *
 * This table is owned by `social-organic` and is deliberately NOT
 * `inbox_webhook_logs`. Those two surfaces belong to different Meta apps with
 * different secrets (blueprint §6.3, AF-10), so sharing storage would put rows
 * that were verified against different trust roots into one table with no
 * column able to tell them apart.
 *
 * Three properties matter more than the column list:
 *
 * 1. **Scope may be NULL.** A webhook arrives with no `RequestContext`; the
 *    scope is resolved server-side from the provider's own asset id, and that
 *    lookup can legitimately fail (asset not connected here, or the same
 *    external id visible in more than one scope). Such a row is persisted
 *    unresolved rather than guessed at — see `scope_resolution`.
 * 2. **`raw_payload` never leaves the backend.** It exists for replay and
 *    audit. No view projects it, and no controller returns it. It can contain
 *    provider-side PII (comment text, commenter identity), which is why §13.1's
 *    "log raw payloads" is implemented with a retention column rather than an
 *    unbounded log.
 * 3. **`event_key` is the idempotency boundary.** The unique index on it — not
 *    application code — is what makes a redelivery a no-op.
 */
@Entity('social_organic_webhook_events')
@Index('UQ_social_organic_webhook_events_key', ['provider', 'eventKey'], {
  unique: true,
})
@Index('IDX_social_organic_webhook_events_queue', ['availableAt'], {
  where: `"status" = 'received'`,
})
@Index('IDX_social_organic_webhook_events_stale_lock', ['lockedAt'], {
  where: `"status" = 'processing'`,
})
@Index('IDX_social_organic_webhook_events_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'receivedAt',
])
@Index('IDX_social_organic_webhook_events_asset', ['assetId', 'receivedAt'])
@Check(
  'CK_social_organic_webhook_events_status',
  `"status" IN ('received', 'processing', 'processed', 'unhandled', 'failed', 'dead_letter')`,
)
@Check(
  'CK_social_organic_webhook_events_scope_resolution',
  `"scope_resolution" IN ('resolved', 'unresolved_unknown_asset', 'unresolved_ambiguous', 'unresolved_no_asset_id')`,
)
export class SocialOrganicWebhookEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Open-ended, matching every other organic table. */
  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /**
   * The deterministic dedupe key. Meta publishes no stable delivery or change
   * id, and its own documentation tells servers to deduplicate, so this is a
   * fingerprint over the exact received bytes plus the identifying envelope
   * fields. Built by `buildMetaOrganicWebhookEventKey`.
   */
  @Column({ name: 'event_key', type: 'varchar', length: 200 })
  eventKey!: string;

  /** The provider envelope's `object` (`page`, `instagram`, …), or `unknown`. */
  @Column({ name: 'object_type', type: 'varchar', length: 64 })
  objectType!: string;

  /** The provider's own asset id (`entry[].id`) — the only scoping input. */
  @Column({
    name: 'external_asset_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalAssetId!: string | null;

  /**
   * Scope columns are nullable because they are *derived*, never received.
   * A NULL here means the lookup did not produce exactly one asset.
   */
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  /** NULL is ambiguous here: either "agency's own context" or "unresolved". */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  assetId!: string | null;

  /**
   * Disambiguates the scope columns above. `resolved` is the only value for
   * which `tenant_id`/`workspace_id`/`asset_id` are meaningful; the three
   * `unresolved_*` values each record *why* no scope was assigned, so a later
   * task can tell "we do not manage this asset" apart from "two scopes claim
   * this asset" without re-deriving it from the payload.
   */
  @Column({
    name: 'scope_resolution',
    type: 'varchar',
    length: 40,
    default: 'unresolved_no_asset_id',
  })
  scopeResolution!: SocialOrganicWebhookScopeResolution;

  @Column({ type: 'varchar', length: 24, default: 'received' })
  status!: SocialOrganicWebhookEventStatus;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  /**
   * Safe internal code only — never a provider message, token, secret or
   * signature. Blueprint §19.3.
   */
  @Column({
    name: 'safe_error_code',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  safeErrorCode!: string | null;

  /**
   * The exact provider payload, for replay and audit. Backend-only: it may
   * carry PII, so no view, controller or projection may return it, and
   * `retain_until` exists so a retention job can delete it without deleting the
   * receipt. Purging it is a follow-up, not part of W1.1.
   */
  @Column({ name: 'raw_payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  rawPayload!: Record<string, unknown>;

  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
