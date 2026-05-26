import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';

@Entity('finance_recurring_profiles')
export class FinanceRecurringProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ name: 'source_module', type: 'varchar', length: 80, nullable: true })
  sourceModule!: string | null;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FinanceRecurringProfileStatus,
    default: FinanceRecurringProfileStatus.Draft,
  })
  status!: FinanceRecurringProfileStatus;

  @Column({
    name: 'interval',
    type: 'enum',
    enum: FinanceRecurringInterval,
    default: FinanceRecurringInterval.Monthly,
  })
  interval!: FinanceRecurringInterval;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ name: 'next_invoice_date', type: 'date', nullable: true })
  nextInvoiceDate!: string | null;

  @Column({ name: 'last_invoice_date', type: 'date', nullable: true })
  lastInvoiceDate!: string | null;

  @Column({ name: 'auto_generate_invoice', type: 'boolean', default: true })
  autoGenerateInvoice!: boolean;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
