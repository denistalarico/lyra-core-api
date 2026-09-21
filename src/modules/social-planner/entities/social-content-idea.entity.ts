import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialContentIdeaStatus = 'open' | 'converted' | 'discarded';

/**
 * A pauta with no date and no plan.
 *
 * This is a separate table rather than a nullable plan_id on
 * social_content_items on purpose. Every existing Planner query filters by
 * scope and joins by plan; relaxing that column would make dateless ideas
 * start appearing in reads written under the assumption that they cannot.
 *
 * An idea also has no destinations, no revisions and no publication. It
 * becomes content through an explicit conversion, which is the only moment it
 * acquires a plan.
 */
@Entity('social_content_ideas')
@Index('IDX_social_content_ideas_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Index('IDX_social_content_ideas_backlog', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'status',
  'priority',
])
@Check(
  'CK_social_content_ideas_status',
  `"status" IN ('open', 'converted', 'discarded')`,
)
@Check('CK_social_content_ideas_priority', '"priority" >= 0')
@Check(
  'CK_social_content_ideas_conversion',
  `("status" = 'converted') = ("converted_content_item_id" IS NOT NULL)`,
)
export class SocialContentIdeaEntity {
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

  @Column({ type: 'varchar', length: 240 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'pillar_id', type: 'uuid', nullable: true })
  pillarId!: string | null;

  @Column({ name: 'campaign_instance_id', type: 'uuid', nullable: true })
  campaignInstanceId!: string | null;

  @Column({ name: 'funnel_stage', type: 'varchar', length: 80, nullable: true })
  funnelStage!: string | null;

  @Column({ name: 'content_type', type: 'varchar', length: 80, nullable: true })
  contentType!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: SocialContentIdeaStatus;

  /** Higher first in the backlog. Zero is "unranked", not "lowest". */
  @Column({ type: 'integer', default: 0 })
  priority!: number;

  /**
   * Where the idea came from. A free varchar rather than an enum because the
   * Intelligence Layer and the Creative Studio will each want their own value
   * and neither is designed yet.
   */
  @Column({ type: 'varchar', length: 40, default: 'manual' })
  source!: string;

  /**
   * What the idea became. Enforced by a database check together with status:
   * converted implies a target and an unconverted idea cannot name one.
   *
   * No foreign key on purpose — deleting a content item must not erase the
   * record that this pauta was once acted on.
   */
  @Column({
    name: 'converted_content_item_id',
    type: 'uuid',
    nullable: true,
  })
  convertedContentItemId!: string | null;

  @Column({ name: 'converted_at', type: 'timestamptz', nullable: true })
  convertedAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
