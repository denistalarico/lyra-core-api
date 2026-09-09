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
 * A reusable campaign shape.
 *
 * A template is not a campaign. It carries no dates and nothing attaches
 * content to it — it exists so an agency that runs "Black Friday" every year
 * does not rebuild the same objective and pillar mix from scratch.
 */
@Entity('social_campaign_templates')
@Index('IDX_social_campaign_templates_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Check(
  'CK_social_campaign_templates_pillars_array',
  `jsonb_typeof("recommended_pillars") = 'array'`,
)
@Check(
  'CK_social_campaign_templates_duration',
  '"default_duration_days" IS NULL OR "default_duration_days" > 0',
)
export class SocialCampaignTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /**
   * NULL means the agency's own Social context.
   * Always resolved server-side, never accepted from a request body.
   */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ type: 'varchar', length: 240 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  objective!: string | null;

  @Column({ name: 'default_duration_days', type: 'integer', nullable: true })
  defaultDurationDays!: number | null;

  /**
   * Pillar keys this template suggests, not pillar ids.
   *
   * Keys survive a pillar being deleted and recreated, and a template is a
   * suggestion rather than a reference — an unknown key is simply ignored when
   * the campaign is instantiated.
   */
  @Column({
    name: 'recommended_pillars',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  recommendedPillars!: string[];

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
