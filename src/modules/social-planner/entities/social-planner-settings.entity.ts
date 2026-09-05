import type {
  SocialPlannerCtaDefaults,
  SocialPlannerFirstCommentDefaults,
  SocialPlannerFunnelDistribution,
  SocialPlannerHashtagDefaults,
  SocialPlannerCatalogItem,
  SocialPlannerMilestone,
} from '../contracts';

import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Strategic defaults for one Social Planner operational context.
 *
 * The JSON structures are intentionally flexible catalogs. Their public
 * contract is validated by the Planner DTO/service layer rather than frozen
 * into PostgreSQL enums or provider-specific schemas.
 */
@Entity('social_planner_settings')
@Index('IDX_social_planner_settings_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Check(
  'CK_social_planner_settings_monthly_volume',
  '"monthly_content_volume" >= 1 AND "monthly_content_volume" <= 365',
)
@Check(
  'CK_social_planner_settings_funnel_object',
  `jsonb_typeof("funnel_distribution") = 'object'`,
)
@Check(
  'CK_social_planner_settings_content_types_array',
  `jsonb_typeof("content_types") = 'array'`,
)
@Check(
  'CK_social_planner_settings_objectives_array',
  `jsonb_typeof("objectives") = 'array'`,
)
@Check(
  'CK_social_planner_settings_creative_formats_array',
  `jsonb_typeof("creative_formats") = 'array'`,
)
@Check(
  'CK_social_planner_settings_cta_object',
  `jsonb_typeof("cta_defaults") = 'object'`,
)
@Check(
  'CK_social_planner_settings_hashtag_object',
  `jsonb_typeof("hashtag_defaults") = 'object'`,
)
@Check(
  'CK_social_planner_settings_first_comment_object',
  `jsonb_typeof("first_comment_defaults") = 'object'`,
)
@Check(
  'CK_social_planner_settings_hooks_array',
  `jsonb_typeof("hook_library") = 'array'`,
)
@Check(
  'CK_social_planner_settings_milestones_array',
  `jsonb_typeof("milestones") = 'array'`,
)
export class SocialPlannerSettingsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL = agency Social context; non-null = managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({
    name: 'monthly_content_volume',
    type: 'smallint',
    default: 8,
  })
  monthlyContentVolume!: number;

  @Column({
    name: 'funnel_distribution',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  funnelDistribution!: SocialPlannerFunnelDistribution;

  @Column({
    name: 'content_types',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  contentTypes!: SocialPlannerCatalogItem[];

  @Column({
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  objectives!: SocialPlannerCatalogItem[];

  @Column({
    name: 'creative_formats',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  creativeFormats!: SocialPlannerCatalogItem[];

  @Column({
    name: 'cta_defaults',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  ctaDefaults!: SocialPlannerCtaDefaults;

  @Column({
    name: 'hashtag_defaults',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  hashtagDefaults!: SocialPlannerHashtagDefaults;

  @Column({
    name: 'first_comment_defaults',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  firstCommentDefaults!: SocialPlannerFirstCommentDefaults;

  @Column({
    name: 'hook_library',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  hookLibrary!: string[];

  @Column({
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  milestones!: SocialPlannerMilestone[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
