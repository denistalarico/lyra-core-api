import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  FinanceBillRecurrenceFrequency,
  FinanceBillRecurrenceStatus,
} from '../enums';

/**
 * Snapshot of a bill line kept on the recurrence profile so future bills can be
 * generated even if the source bill is later cancelled or deleted. Typed enough
 * to preserve description, amounts, category, cost center and any extra
 * dimensions (client/project/account/tax) carried in `metadata`.
 */
export interface FinanceBillRecurrenceLineTemplate {
  description: string;
  quantity: string;
  unitPrice: string;
  taxAmount: string;
  categoryId: string | null;
  costCenterId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Recurrence profile for payables (contas a pagar). It NEVER posts to the
 * ledger directly: it only generates new `finance_bills`, and the existing bill
 * flow recognises them (DEBIT cost / CREDIT payable) when they are confirmed/opened.
 */
@Entity('finance_bill_recurrences')
export class FinanceBillRecurrence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** Bill that originated this recurrence (the first, manually created one). */
  @Column({ name: 'source_bill_id', type: 'uuid', nullable: true })
  sourceBillId!: string | null;

  @Column({ name: 'vendor_id', type: 'uuid', nullable: true })
  vendorId!: string | null;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'BRL' })
  currency!: string;

  /** Snapshot of the recurring total (sum of the line template). */
  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2, default: 0 })
  amount!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FinanceBillRecurrenceStatus,
    enumName: 'finance_bill_recurrences_status_enum',
    default: FinanceBillRecurrenceStatus.Draft,
  })
  status!: FinanceBillRecurrenceStatus;

  @Column({
    name: 'frequency',
    type: 'enum',
    enum: FinanceBillRecurrenceFrequency,
    enumName: 'finance_bill_recurrences_frequency_enum',
    default: FinanceBillRecurrenceFrequency.Monthly,
  })
  frequency!: FinanceBillRecurrenceFrequency;

  /** "A cada X períodos" (e.g. frequency=monthly + intervalCount=2 → bimonthly). */
  @Column({ name: 'interval_count', type: 'integer', default: 1 })
  intervalCount!: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  /** Stop after this many generated bills (excludes the source bill). */
  @Column({ name: 'occurrences_limit', type: 'integer', nullable: true })
  occurrencesLimit!: number | null;

  @Column({ name: 'occurrences_created', type: 'integer', default: 0 })
  occurrencesCreated!: number;

  /** Date the next bill should be generated (authoritative for run-due). */
  @Column({ name: 'next_generation_date', type: 'date', nullable: true })
  nextGenerationDate!: string | null;

  /** Day of month the next bill is created (informative; reflected in next_generation_date). */
  @Column({ name: 'generation_day', type: 'integer', nullable: true })
  generationDay!: number | null;

  /** Day of month for the generated bill's due date. */
  @Column({ name: 'due_day', type: 'integer', nullable: true })
  dueDay!: number | null;

  /** Status the generated bill is created with ('draft' | 'open'). */
  @Column({ name: 'generate_as_status', type: 'varchar', length: 20, default: 'draft' })
  generateAsStatus!: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId!: string | null;

  @Column({
    name: 'line_template',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  lineTemplate!: FinanceBillRecurrenceLineTemplate[];

  @Column({ name: 'last_generated_at', type: 'timestamptz', nullable: true })
  lastGeneratedAt!: Date | null;

  @Column({ name: 'last_generated_bill_id', type: 'uuid', nullable: true })
  lastGeneratedBillId!: string | null;

  /** Quick on/off flag kept in sync with the status lifecycle. */
  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
