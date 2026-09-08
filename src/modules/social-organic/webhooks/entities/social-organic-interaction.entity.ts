import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Provider-neutral interaction taxonomy.
 *
 * Names follow the module's existing `snake_case` convention for varchar
 * discriminators (`asset_type`, `scope_resolution`, `last_health_status`) and
 * are deliberately **not** Meta's own vocabulary: `verb: "edited"` and
 * `verb: "update"` are the same lifecycle event to this module, and a second
 * provider must be able to reuse `post_updated` without adopting Meta's enum.
 *
 * `page_feed_other` is not a failure — it is the honest classification of a
 * documented `feed` subtype (a reaction, a share, a status change) that this
 * version records but does not model. Collapsing it into "comment" would be a
 * lie; dropping it would lose the receipt's link to a real Page event.
 */
export type SocialOrganicInteractionType =
  | 'post_created'
  | 'post_updated'
  | 'post_removed'
  | 'comment_created'
  | 'comment_updated'
  | 'comment_removed'
  | 'mention_created'
  | 'page_feed_other';

/** Which subscribed surface produced the interaction. */
export type SocialOrganicInteractionSurface =
  | 'page_feed'
  | 'page_mention'
  | 'instagram_comments'
  | 'instagram_mentions';

export type SocialOrganicInteractionStatus = 'active' | 'removed';

/**
 * One normalized organic interaction: a post, comment or mention observed on a
 * connected asset.
 *
 * **Why this is not `social_organic_webhook_events`.** That table is transport:
 * one row per *delivery*, keyed by a fingerprint of the received bytes, holding
 * the raw payload for audit. This table is product: one row per *thing that
 * happened*, keyed by the provider's own id for that thing, holding only the
 * normalized fields a Social feature needs. A redelivery writes a second
 * receipt only if the bytes differ, but must never create a second interaction —
 * which is exactly what `UQ_social_organic_interactions_external` enforces.
 *
 * **Why it is provider-neutral.** No `meta_` prefix, no Meta enum stored raw,
 * no per-provider table. `provider` + `external_*` ids carry the provider's
 * identity; everything else is vocabulary this module owns. The task's §8
 * preference for one shared model over a table per provider is the reason.
 *
 * **PII posture (§10).** A comment carries a person's name, username and free
 * text. Stored here are: the actor's external id (needed to recognize a
 * repeat commenter), an optional display name, and optional text — nothing
 * else, and never the payload again. The raw payload already exists exactly
 * once, on the receipt, under that table's `retain_until`. `retain_until` is
 * repeated here so the two can be purged on the same schedule; the purge job
 * itself remains a documented follow-up, unchanged by this task.
 */
@Entity('social_organic_interactions')
@Unique('UQ_social_organic_interactions_external', [
  'provider',
  'assetId',
  'externalInteractionId',
])
@Index('IDX_social_organic_interactions_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'occurredAt',
])
@Index('IDX_social_organic_interactions_asset', ['assetId', 'occurredAt'])
@Index('IDX_social_organic_interactions_content', [
  'assetId',
  'externalContentId',
])
@Check(
  'CK_social_organic_interactions_type',
  `"interaction_type" IN (
    'post_created', 'post_updated', 'post_removed',
    'comment_created', 'comment_updated', 'comment_removed',
    'mention_created', 'page_feed_other'
  )`,
)
@Check(
  'CK_social_organic_interactions_surface',
  `"surface" IN ('page_feed', 'page_mention', 'instagram_comments', 'instagram_mentions')`,
)
@Check(
  'CK_social_organic_interactions_status',
  `"status" IN ('active', 'removed')`,
)
export class SocialOrganicInteractionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Scope is NOT nullable here, unlike on the receipt.
   *
   * A receipt must survive an unresolvable scope — it is evidence that Meta
   * sent something. An interaction must not: a row with no tenant could not be
   * shown to anyone without guessing who owns it. Unresolved deliveries stop at
   * the receipt with `unresolved_*`, which is why the Meta console's test event
   * (asset id `0`) produces no interaction and that is the correct outcome.
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context — never "unknown". */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /**
   * The connected asset this happened on. No FK: an interaction must outlive
   * the disconnection of its asset, exactly as the receipt does.
   */
  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ type: 'varchar', length: 40 })
  surface!: SocialOrganicInteractionSurface;

  @Column({ name: 'interaction_type', type: 'varchar', length: 40 })
  interactionType!: SocialOrganicInteractionType;

  /**
   * The provider's id for the thing itself — a comment id, a post id, a mention's
   * comment or media id. Part of the uniqueness key, so a handler that cannot
   * find one must fail with `missing_external_id` rather than invent one.
   */
  @Column({
    name: 'external_interaction_id',
    type: 'varchar',
    length: 180,
  })
  externalInteractionId!: string;

  /** Parent comment for a reply; NULL for a top-level interaction. */
  @Column({
    name: 'external_parent_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalParentId!: string | null;

  /** The post or media the interaction is attached to, when the payload says. */
  @Column({
    name: 'external_content_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalContentId!: string | null;

  /**
   * The commenter/author as the provider identifies them (an IG-scoped id or a
   * Page-scoped user id). Nullable because Meta documents `page/mention`'s
   * `from` as Workplace-only, so a consumer Page mention genuinely has no actor.
   */
  @Column({
    name: 'actor_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  actorExternalId!: string | null;

  /** Display name or username exactly as delivered; never derived or enriched. */
  @Column({
    name: 'actor_display_name',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  actorDisplayName!: string | null;

  /**
   * Comment or post text, when the payload carries it. Truncated on write: a
   * caption can exceed any sane column, and Social's use for this is display
   * and triage, not archival — the untruncated original stays on the receipt
   * under its retention window.
   */
  @Column({ type: 'text', nullable: true })
  text!: string | null;

  /**
   * When the interaction happened, per the provider. Falls back to the entry's
   * notification time when the change value carries no `created_time`, because
   * an interaction with no time cannot be ordered in a feed.
   */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  /** The provider's own `created_time`, when it sent one. NULL is meaningful. */
  @Column({
    name: 'provider_created_at',
    type: 'timestamptz',
    nullable: true,
  })
  providerCreatedAt!: Date | null;

  /**
   * `removed` is set by a later delete/remove notification converging onto the
   * same row. The row is kept rather than deleted so a UI can show that a
   * comment it displayed is gone, instead of silently losing it.
   */
  @Column({ type: 'varchar', length: 24, default: 'active' })
  status!: SocialOrganicInteractionStatus;

  /**
   * Minimal, safe provider context — never the raw payload.
   *
   * What goes here is bounded and non-PII: the provider's own `field`, and the
   * raw `item`/`verb` for a `page/feed` change so an operator can tell which
   * documented subtype produced a `page_feed_other` row without re-reading the
   * receipt. Text, names and ids do not belong here; they have columns.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  /**
   * The receipt that produced this row, for audit. Deliberately not an FK with
   * cascade: purging receipts must not delete product data.
   */
  @Column({ name: 'source_webhook_event_id', type: 'uuid', nullable: true })
  sourceWebhookEventId!: string | null;

  /** Mirrors the receipt's retention column so both can be purged together. */
  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
