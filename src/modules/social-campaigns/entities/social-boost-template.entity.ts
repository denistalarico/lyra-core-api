import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialAdsProvider = 'meta' | 'google' | 'tiktok';
export type SocialBoostBudgetType = 'daily' | 'lifetime';
export type SocialBoostAudienceMode =
  | 'automatic'
  | 'custom'
  | 'saved'
  | 'followers'
  | 'engagers';
export type SocialBoostObjective =
  | 'awareness'
  | 'traffic'
  | 'engagement'
  | 'leads'
  | 'sales'
  | 'followers';
export type SocialBoostPerformanceGoal =
  | 'reach'
  | 'impressions'
  | 'link_clicks'
  | 'landing_page_views'
  | 'post_engagement'
  | 'thruplay'
  | 'two_second_video_views'
  | 'messaging_conversations_started'
  | 'instant_form_leads'
  | 'website_leads'
  | 'conversions'
  | 'value'
  | 'profile_visits'
  | 'page_likes';
export type SocialBoostConversionLocation =
  | 'on_ad'
  | 'website'
  | 'messaging_apps'
  | 'instant_forms'
  | 'instagram_profile'
  | 'facebook_page'
  | 'shop';

export type SocialBoostAudience = {
  countries: string[];
  regions: string[];
  cities: string[];
  postalCodes: string[];
  ageMin: number | null;
  ageMax: number | null;
  genders: string[];
  languages: string[];
  interests: string[];
  savedAudienceExternalId: string | null;
};

/**
 * A reusable input recipe for Planner Boost.
 *
 * This row never means that an ad exists at the provider. It is local intent:
 * a future governed action will combine it with one approved publication,
 * validate it against the selected ad account and only then call the provider.
 */
@Entity('social_boost_templates')
@Index('IDX_social_boost_templates_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'provider',
])
@Check(
  'CK_social_boost_templates_provider',
  `"provider" IN ('meta', 'google', 'tiktok')`,
)
@Check(
  'CK_social_boost_templates_budget_type',
  `"budget_type" IN ('daily', 'lifetime')`,
)
@Check(
  'CK_social_boost_templates_objective',
  `"objective" IN ('awareness', 'traffic', 'engagement', 'leads', 'sales', 'followers')`,
)
@Check(
  'CK_social_boost_templates_performance_goal',
  `"performance_goal" IN ('reach', 'impressions', 'link_clicks', 'landing_page_views', 'post_engagement', 'thruplay', 'two_second_video_views', 'messaging_conversations_started', 'instant_form_leads', 'website_leads', 'conversions', 'value', 'profile_visits', 'page_likes')`,
)
@Check(
  'CK_social_boost_templates_conversion_location',
  `"conversion_location" IN ('on_ad', 'website', 'messaging_apps', 'instant_forms', 'instagram_profile', 'facebook_page', 'shop')`,
)
@Check(
  'CK_social_boost_templates_audience_mode',
  `"audience_mode" IN ('automatic', 'custom', 'saved', 'followers', 'engagers')`,
)
@Check('CK_social_boost_templates_budget', '"budget_amount_minor" > 0')
@Check(
  'CK_social_boost_templates_duration',
  '"duration_days" >= 1 AND "duration_days" <= 90',
)
@Check(
  'CK_social_boost_templates_audience_object',
  `jsonb_typeof("audience") = 'object'`,
)
@Check(
  'CK_social_boost_templates_placements_array',
  `jsonb_typeof("placements") = 'array'`,
)
@Check(
  'CK_social_boost_templates_special_categories_array',
  `jsonb_typeof("special_ad_categories") = 'array'`,
)
export class SocialBoostTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own Social context. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  provider!: SocialAdsProvider;

  /** Lyra vocabulary. Provider mapping belongs to the future execution port. */
  @Column({ type: 'varchar', length: 40 })
  objective!: SocialBoostObjective;

  /** Lyra canonical goal. Mapping to Meta optimization_goal is execution work. */
  @Column({ name: 'performance_goal', type: 'varchar', length: 60 })
  performanceGoal!: SocialBoostPerformanceGoal;

  @Column({ name: 'conversion_location', type: 'varchar', length: 40 })
  conversionLocation!: SocialBoostConversionLocation;

  /** Optional semantic event such as PURCHASE or LEAD; never a Pixel id. */
  @Column({
    name: 'conversion_event',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  conversionEvent!: string | null;

  @Column({ name: 'budget_type', type: 'varchar', length: 20 })
  budgetType!: SocialBoostBudgetType;

  /** Currency minor units; never a floating-point monetary value. */
  @Column({ name: 'budget_amount_minor', type: 'bigint' })
  budgetAmountMinor!: string;

  @Column({ type: 'varchar', length: 8 })
  currency!: string;

  @Column({ name: 'duration_days', type: 'integer' })
  durationDays!: number;

  @Column({ name: 'audience_mode', type: 'varchar', length: 20 })
  audienceMode!: SocialBoostAudienceMode;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  audience!: SocialBoostAudience;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  placements!: string[];

  /**
   * Meta requires every campaign creation to declare special-ad categories.
   * An empty array means none; the preflight must never infer that decision.
   */
  @Column({
    name: 'special_ad_categories',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  specialAdCategories!: string[];

  @Column({
    name: 'call_to_action',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  callToAction!: string | null;

  @Column({ name: 'destination_url', type: 'text', nullable: true })
  destinationUrl!: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
