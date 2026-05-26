import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FinanceMetricKey, FinanceMetricPeriodType } from '../enums';

@Entity('finance_metric_snapshots')
export class FinanceMetricSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'metric_key',
    type: 'enum',
    enum: FinanceMetricKey,
  })
  metricKey!: FinanceMetricKey;

  @Column({
    name: 'period_type',
    type: 'enum',
    enum: FinanceMetricPeriodType,
    default: FinanceMetricPeriodType.Monthly,
  })
  periodType!: FinanceMetricPeriodType;

  @Column({ name: 'period_start', type: 'date' })
  periodStart!: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd!: string;

  @Column({ name: 'value', type: 'numeric', precision: 16, scale: 4, default: 0 })
  value!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({ name: 'source', type: 'varchar', length: 80, default: 'system' })
  source!: string;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
