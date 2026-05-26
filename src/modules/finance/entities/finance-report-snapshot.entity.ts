import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FinanceMetricPeriodType, FinanceReportType } from '../enums';

@Entity('finance_report_snapshots')
export class FinanceReportSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    name: 'report_type',
    type: 'enum',
    enum: FinanceReportType,
  })
  reportType!: FinanceReportType;

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

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
