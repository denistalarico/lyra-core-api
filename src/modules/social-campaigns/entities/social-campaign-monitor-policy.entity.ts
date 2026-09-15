import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialCampaignAlertChannel = 'in_app' | 'email' | 'whatsapp';

/**
 * Deterministic spend guardrails for one connected ad account.
 *
 * The scope is copied onto the policy deliberately. A background evaluation has
 * no HTTP request from which to recover managed context, so its trusted scope is
 * the row that an authorised request created. No endpoint accepts those fields.
 */
@Entity('social_campaign_monitor_policies')
@Index(
  'UQ_social_campaign_monitor_policies_connection',
  ['connectionId'],
  { unique: true },
)
@Index('IDX_social_campaign_monitor_policies_due', ['enabled', 'updatedAt'])
@Check(
  'CK_social_campaign_monitor_policy_limits',
  `("daily_spend_limit_minor" IS NULL OR "daily_spend_limit_minor" >= 100)
   AND ("monthly_spend_limit_minor" IS NULL OR "monthly_spend_limit_minor" >= 100)
   AND ("balance_floor_minor" IS NULL OR "balance_floor_minor" >= 0)
   AND "cooldown_minutes" BETWEEN 15 AND 10080
   AND (NOT "enabled" OR "daily_spend_limit_minor" IS NOT NULL
     OR "monthly_spend_limit_minor" IS NOT NULL OR "balance_floor_minor" IS NOT NULL)`,
)
@Check(
  'CK_social_campaign_monitor_policy_channels',
  `jsonb_typeof("delivery_channels") = 'array'
   AND "delivery_channels" @> '["in_app"]'::jsonb
   AND "delivery_channels" <@ '["in_app", "email", "whatsapp"]'::jsonb`,
)
export class SocialCampaignMonitorPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'daily_spend_limit_minor', type: 'bigint', nullable: true })
  dailySpendLimitMinor!: string | null;

  @Column({ name: 'monthly_spend_limit_minor', type: 'bigint', nullable: true })
  monthlySpendLimitMinor!: string | null;

  @Column({ name: 'balance_floor_minor', type: 'bigint', nullable: true })
  balanceFloorMinor!: string | null;

  @Column({ name: 'cooldown_minutes', type: 'integer', default: 360 })
  cooldownMinutes!: number;

  /** External values are preferences until their platform adapters are wired. */
  @Column({ name: 'delivery_channels', type: 'jsonb', default: () => `'["in_app"]'::jsonb` })
  deliveryChannels!: SocialCampaignAlertChannel[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
