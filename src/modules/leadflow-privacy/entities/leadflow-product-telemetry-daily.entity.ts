import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Index(
  'UQ_lf_product_telemetry_daily_fact',
  ['scopePseudonym', 'observedOn', 'metricKey', 'dimensionKey'],
  { unique: true },
)
@Index('IDX_lf_product_telemetry_daily_aggregate', [
  'observedOn',
  'metricKey',
  'dimensionKey',
])
@Entity('leadflow_product_telemetry_daily')
export class LeadFlowProductTelemetryDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Deliberately the only scope reference in this product-telemetry table.
   * Raw tenant/workspace/client identifiers live in the separate identity-link
   * table and are never copied here.
   */
  @Column({ name: 'scope_pseudonym', type: 'uuid' })
  scopePseudonym!: string;

  @Column({ name: 'observed_on', type: 'date' })
  observedOn!: string;

  @Column({ name: 'metric_key', type: 'varchar', length: 80 })
  metricKey!: string;

  @Column({
    name: 'dimension_key',
    type: 'varchar',
    length: 80,
    default: 'all',
  })
  dimensionKey!: string;

  @Column({ name: 'metric_value', type: 'bigint' })
  metricValue!: string;

  @Column({ name: 'sample_size', type: 'integer' })
  sampleSize!: number;

  @Column({ name: 'source_period_from', type: 'timestamptz' })
  sourcePeriodFrom!: Date;

  @Column({ name: 'source_period_to', type: 'timestamptz' })
  sourcePeriodTo!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
