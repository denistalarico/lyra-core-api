import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The creative chosen for one editorial destination (Planner E5).
 *
 * WHY THIS IS NOT A COLUMN ON THE CONTENT ITEM
 * --------------------------------------------
 * A content item may carry several destinations (Story and Feed), and E5's
 * whole point is that each of them can receive a different creative. A single
 * `media_asset_id` on `social_content_items` would force one file to serve
 * every destination, which is precisely the shape a 9:16 Story and a 4:5 Feed
 * post cannot share.
 *
 * WHY IT IS NOT A COLUMN ON THE DESTINATION EITHER
 * ------------------------------------------------
 * `social_content_destinations` is replaced wholesale by
 * `PUT /content/:id/destinations` — the service deletes every row and inserts
 * the new set. A creative stored there would be silently destroyed every time
 * an operator edited the destination list. A separate table lets that
 * replacement cascade deliberately (the link dies with its destination) while
 * keeping the two write paths independent.
 *
 * WHY IT IS NOT THE PUBLICATION
 * -----------------------------
 * `social_publications.media_asset_id` is execution evidence: it records what
 * a provider attempt actually carried, and it is immutable once processing
 * starts. This table is editorial intent, mutable until publication time. The
 * two are deliberately separate, exactly as `destination.plannedAt` is
 * separate from `publication.scheduledAt`.
 *
 * ONE MEDIA PER DESTINATION (this campaign)
 * -----------------------------------------
 * `role` and `sort_order` exist so a carousel can be expressed later without a
 * migration, but the unique index below allows exactly one `primary` row per
 * destination. Carousel is explicitly out of scope: the publication contract
 * persists a single `media_asset_id` and no declared capability accepts
 * multi-media, so admitting a second row today would let the Planner record an
 * intent no adapter can execute.
 */
@Entity('social_destination_creatives')
@Index('IDX_social_destination_creatives_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_destination_creatives_destination', ['destinationId'])
@Index('IDX_social_destination_creatives_content', ['contentItemId'])
export class SocialDestinationCreativeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'destination_id', type: 'uuid' })
  destinationId!: string;

  /**
   * Denormalized from the destination so listing every creative of a content
   * item is one indexed query instead of a join through the destination set.
   * The service always derives it from the resolved destination — it is never
   * read from a request body.
   */
  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @Column({ name: 'media_asset_id', type: 'uuid' })
  mediaAssetId!: string;

  /**
   * The connected account this creative was validated against.
   *
   * Capability is a property of `(provider, assetType, placement)`, and a
   * destination's `channel` ("instagram") is editorial intent, not a concrete
   * connected account — a workspace may have several. Persisting the asset the
   * check ran against is what makes the stored validation meaningful: without
   * it, "this file passed" would be a claim about an account nobody recorded.
   */
  @Column({ name: 'organic_asset_id', type: 'uuid' })
  organicAssetId!: string;

  /**
   * Open vocabulary: `primary` today, `cover`/`slide` reserved for a future
   * multi-media contract. A varchar rather than an enum so adding a role never
   * requires a migration (same reasoning as `MediaAsset.source`).
   */
  @Column({ type: 'varchar', length: 40, default: 'primary' })
  role!: string;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  /**
   * Where the creative came from: `manual`, `creative_studio`, `pletor` or a
   * source that does not exist yet. Open on purpose — E5's definition of done
   * requires the schema to accept future sources without a migration.
   */
  @Column({ type: 'varchar', length: 40, default: 'manual' })
  source!: string;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
