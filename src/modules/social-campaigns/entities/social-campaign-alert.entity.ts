import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialCampaignAlertType =
  | 'daily_spend_limit'
  | 'monthly_spend_limit'
  | 'low_balance';
export type SocialCampaignAlertStatus = 'open' | 'acknowledged' | 'resolved';

/** A local, auditable alert. It never contains provider payloads or credentials. */
@Entity('social_campaign_alerts')
@Index('UQ_social_campaign_alerts_deduplication', ['deduplicationKey'], {
  unique: true,
})
@Index('IDX_social_campaign_alerts_scope_status', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'connectionId',
  'status',
  'lastTriggeredAt',
])
@Check(
  'CK_social_campaign_alert_values',
  `"current_value_minor" >= 0 AND "threshold_minor" >= 0 AND "occurrence_count" > 0`,
)
export class SocialCampaignAlertEntity {
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

  @Column({ name: 'policy_id', type: 'uuid' })
  policyId!: string;

  @Column({ name: 'alert_type', type: 'varchar', length: 40 })
  alertType!: SocialCampaignAlertType;

  @Column({ type: 'varchar', length: 24, default: 'open' })
  status!: SocialCampaignAlertStatus;

  @Column({ name: 'current_value_minor', type: 'bigint' })
  currentValueMinor!: string;

  @Column({ name: 'threshold_minor', type: 'bigint' })
  thresholdMinor!: string;

  @Column({ type: 'varchar', length: 8 })
  currency!: string;

  @Column({ name: 'period_key', type: 'varchar', length: 20 })
  periodKey!: string;

  @Column({ name: 'deduplication_key', type: 'varchar', length: 64 })
  deduplicationKey!: string;

  @Column({ name: 'occurrence_count', type: 'integer', default: 1 })
  occurrenceCount!: number;

  @Column({ name: 'first_triggered_at', type: 'timestamptz' })
  firstTriggeredAt!: Date;

  @Column({ name: 'last_triggered_at', type: 'timestamptz' })
  lastTriggeredAt!: Date;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ name: 'acknowledged_by_id', type: 'uuid', nullable: true })
  acknowledgedById!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'observed_at', type: 'timestamptz', nullable: true })
  observedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
