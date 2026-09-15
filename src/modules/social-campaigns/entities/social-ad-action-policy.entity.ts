import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Explicit per-account opt-in for manual Meta writes. */
@Entity('social_ad_action_policies')
@Index('IDX_social_ad_action_policies_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'connectionId',
])
@Check(
  'CK_social_ad_action_policy_limits',
  `("max_budget_minor" IS NULL OR "max_budget_minor" > 0)
   AND "max_budget_increase_percent" BETWEEN 0 AND 100
   AND "confirmation_ttl_minutes" BETWEEN 1 AND 60`,
)
export class SocialAdActionPolicyEntity {
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

  @Column({ name: 'allow_status', type: 'boolean', default: true })
  allowStatus!: boolean;

  @Column({ name: 'allow_budget', type: 'boolean', default: false })
  allowBudget!: boolean;

  @Column({ name: 'allow_schedule', type: 'boolean', default: false })
  allowSchedule!: boolean;

  @Column({ name: 'allow_delete', type: 'boolean', default: false })
  allowDelete!: boolean;

  @Column({ name: 'allow_boost', type: 'boolean', default: false })
  allowBoost!: boolean;

  @Column({ name: 'max_budget_minor', type: 'bigint', nullable: true })
  maxBudgetMinor!: string | null;

  @Column({
    name: 'max_budget_increase_percent',
    type: 'integer',
    default: 25,
  })
  maxBudgetIncreasePercent!: number;

  @Column({ name: 'confirmation_ttl_minutes', type: 'integer', default: 10 })
  confirmationTtlMinutes!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
