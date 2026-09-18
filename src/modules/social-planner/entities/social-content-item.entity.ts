import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialContentPlanningStatus =
  | 'idea'
  | 'planned'
  | 'copy_in_progress'
  | 'copy_ready'
  | 'creative_in_progress'
  | 'creative_ready'
  | 'ready';

@Entity('social_content_items')
@Index('IDX_social_content_items_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_content_items_plan', ['planId', 'sortOrder'])
@Check(
  'CK_social_content_items_status',
  `"planning_status" IN ('idea', 'planned', 'copy_in_progress', 'copy_ready', 'creative_in_progress', 'creative_ready', 'ready')`,
)
@Check('CK_social_content_items_sort_order', '"sort_order" >= 0')
@Check(
  'CK_social_content_items_hashtags_array',
  `jsonb_typeof("hashtags") = 'array'`,
)
export class SocialContentItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  theme!: string | null;

  @Column({ type: 'text', nullable: true })
  brief!: string | null;

  @Column({ name: 'key_message', type: 'text', nullable: true })
  keyMessage!: string | null;

  /**
   * Current editorial text.
   *
   * Historical snapshots live in social_content_revisions. Keeping the
   * current state here makes Planner reads independent from a revision join.
   */
  @Column({ type: 'text', nullable: true })
  copy!: string | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ type: 'text', nullable: true })
  script!: string | null;

  @Column({ type: 'text', nullable: true })
  cta!: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  hashtags!: string[];

  @Column({
    name: 'first_comment',
    type: 'text',
    nullable: true,
  })
  firstComment!: string | null;

  /**
   * Revision that produced the current textual state.
   * NULL is valid for content created before its first explicit save/generation.
   */
  @Column({
    name: 'current_revision_id',
    type: 'uuid',
    nullable: true,
  })
  currentRevisionId!: string | null;

  /**
   * Funnel stages and content types are deliberately vocabulary keys rather
   * than database enums. Planner Settings will make these catalogs
   * configurable per Social context.
   */
  @Column({
    name: 'funnel_stage',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  funnelStage!: string | null;

  @Column({
    name: 'content_type',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  contentType!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  objective!: string | null;

  @Column({
    name: 'creative_format',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  creativeFormat!: string | null;

  @Column({
    name: 'planning_status',
    type: 'varchar',
    length: 40,
    default: 'planned',
  })
  planningStatus!: SocialContentPlanningStatus;

  /** Calendar quick-add entries publish normally but are not editorial-plan rows. */
  @Column({ name: 'calendar_only', type: 'boolean', default: false })
  calendarOnly!: boolean;

  /**
   * Editorial day only. The exact channel/time belongs to a destination and
   * the actual provider schedule will later belong to SocialPublication.
   */
  @Column({ name: 'planned_date', type: 'date', nullable: true })
  plannedDate!: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  /**
   * Optional classification. Both are nullable and both are set to NULL by the
   * database when the campaign or pillar is deleted: losing a taxonomy entry
   * unclassifies content, it never deletes it.
   *
   * The campaign is not derived from the plan. A campaign spans plans, so a
   * content item names its campaign directly.
   */
  @Column({ name: 'campaign_instance_id', type: 'uuid', nullable: true })
  campaignInstanceId!: string | null;

  @Column({ name: 'editorial_pillar_id', type: 'uuid', nullable: true })
  editorialPillarId!: string | null;

  /**
   * Lifecycle state, deliberately kept out of `planningStatus` (E6).
   *
   * `planningStatus` says how far the editorial work got; these two say whether
   * the row should be listed at all. Both are nullable timestamps rather than
   * booleans because "when" is the part an operator asks about after the fact,
   * and both are kept separate from each other so a restore knows which of the
   * two actions it is undoing.
   *
   * `deletedAt` is a soft delete: `social_publications.content_item_id` is
   * RESTRICT and publication rows are immutable evidence, so a published item
   * can never actually leave the table.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ name: 'archived_by_id', type: 'uuid', nullable: true })
  archivedById!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by_id', type: 'uuid', nullable: true })
  deletedById!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
