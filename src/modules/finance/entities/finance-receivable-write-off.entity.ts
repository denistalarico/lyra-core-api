import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Immutable loss evidence; reversal adds audit fields instead of deleting it. */
@Entity('finance_receivable_write_offs')
export class FinanceReceivableWriteOff {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'invoice_id', type: 'uuid' }) invoiceId!: string;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) amount!: string;
  @Column({ type: 'varchar', length: 3 }) currency!: string;
  @Column({ name: 'write_off_date', type: 'date' }) writeOffDate!: string;
  @Column({ type: 'varchar', length: 2000 }) reason!: string;
  @Column({ type: 'varchar', length: 2000, nullable: true }) evidence!:
    | string
    | null;
  @Column({ name: 'expense_account_id', type: 'uuid' })
  expenseAccountId!: string;
  @Column({ name: 'idempotency_key', type: 'uuid' }) idempotencyKey!: string;
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'active' }) status!:
    | 'active'
    | 'reversed';
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt!: Date | null;
  @Column({ name: 'reversed_by_id', type: 'uuid', nullable: true })
  reversedById!: string | null;
  @Column({ name: 'reversal_date', type: 'date', nullable: true })
  reversalDate!: string | null;
  @Column({
    name: 'reversal_reason',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  reversalReason!: string | null;
  @Column({ name: 'reversal_entry_id', type: 'uuid', nullable: true })
  reversalEntryId!: string | null;
}
