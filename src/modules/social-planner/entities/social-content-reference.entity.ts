import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Planner Visual References — an image specific to one content item (the
 * product, person, packaging, property… of THAT post). Permanent brand
 * imagery belongs to the Brand Kit; nothing here is ever promoted there.
 *
 * A row is only a link to a durable `media_assets` row: the binary is never
 * copied, one media may serve several items (a duplicated item keeps the same
 * file), and removing a reference never deletes the media — orphan binaries
 * are the media lifecycle's job (CS3.6), which must count this table as an
 * owner.
 *
 * Scope is the full four-part scope, written from the item's plan. The
 * database proves it (migration 1798200000000): composite company FK, never
 * legacy, and triggers that keep the item's plan and the media in the same
 * scope — and the media a durable image — on every write path, both sides.
 *
 * At most 10 per item: `sort_order` 0..9, unique per item (deferrable).
 */
@Entity('social_content_references')
@Index('IDX_social_content_references_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Index('IDX_social_content_references_media', ['mediaAssetId'])
export class SocialContentReferenceEntity {
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

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @Column({ name: 'media_asset_id', type: 'uuid' })
  mediaAssetId!: string;

  /**
   * What the image shows (`SOCIAL_CONTENT_REFERENCE_KINDS`). Validated by the
   * DTO; the database only checks the key's shape, so a new kind needs no
   * migration. What a kind MEANS to a provider is decided in CS3.4.2.
   */
  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Column({ type: 'varchar', length: 240, nullable: true })
  label!: string | null;

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** The kinds accepted today. Extending the list is a code change only. */
export const SOCIAL_CONTENT_REFERENCE_KINDS = [
  'product',
  'person',
  'packaging',
  'property',
  'vehicle',
  'environment',
  'apparel',
  'client_provided',
  'style',
] as const;
export type SocialContentReferenceKind =
  (typeof SOCIAL_CONTENT_REFERENCE_KINDS)[number];

export const MAX_SOCIAL_CONTENT_REFERENCES = 10;
