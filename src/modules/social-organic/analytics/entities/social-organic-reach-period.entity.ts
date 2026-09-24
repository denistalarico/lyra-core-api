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
 * A de-duplicated organic reach measurement for one asset and one range.
 *
 * Not a fact table: each row is one *measurement of a period*, taken by asking
 * Meta for the whole range at once. It cannot be derived from
 * `social_organic_account_metrics_daily` by any arithmetic — the information
 * about who appeared on more than one day never leaves Meta — which is exactly
 * why the measurement has to be stored rather than computed.
 *
 * **`reach` here includes ads.** The period request only collapses to a single
 * de-duplicated number when nothing breaks it down, and the breakdown is what
 * the daily ingest uses to isolate organic-only surfaces. So this matches
 * Meta's own "Contas alcançadas" figure and is a different measurement from the
 * daily `reach` column, not a period version of it.
 *
 * Mirrors `SocialAdReachPeriodEntity` on the paid side.
 */
@Entity('social_organic_reach_periods')
@Index(
  'UQ_social_organic_reach_periods_window',
  ['assetId', 'periodSince', 'periodUntil'],
  { unique: true },
)
@Index('IDX_social_organic_reach_periods_scope', [
  'tenantId',
  'workspaceId',
  'assetId',
  'periodUntil',
])
@Check(
  'CK_social_organic_reach_periods_range',
  `"period_until" >= "period_since"`,
)
@Check(
  'CK_social_organic_reach_periods_non_negative',
  `"reach" IS NULL OR "reach" >= 0`,
)
export class SocialOrganicReachPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /** Calendar days in the asset's timezone, inclusive at both ends. */
  @Column({ name: 'period_since', type: 'date' })
  periodSince!: string;

  @Column({ name: 'period_until', type: 'date' })
  periodUntil!: string;

  @Column({ name: 'asset_timezone', type: 'varchar', length: 64 })
  assetTimezone!: string;

  /** NULL when Meta reported none — never conflated with a measured zero. */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  /**
   * Whether the range's last day was still accumulating when this was taken.
   *
   * A window ending today is worth re-measuring; one that has closed is final,
   * and re-reading it would spend quota to learn the same number.
   */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({
    name: 'measured_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  measuredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
