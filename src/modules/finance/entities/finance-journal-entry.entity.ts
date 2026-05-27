import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceJournalEntryStatus } from '../enums';

@Entity('finance_journal_entries')
export class FinanceJournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'entry_number', type: 'varchar', length: 80 })
  entryNumber!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FinanceJournalEntryStatus,
    default: FinanceJournalEntryStatus.Draft,
  })
  status!: FinanceJournalEntryStatus;

  @Column({ name: 'entry_date', type: 'date' })
  entryDate!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'source_module', type: 'varchar', length: 80, nullable: true })
  sourceModule!: string | null;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ name: 'total_debit', type: 'numeric', precision: 14, scale: 2, default: 0 })
  totalDebit!: string;

  @Column({ name: 'total_credit', type: 'numeric', precision: 14, scale: 2, default: 0 })
  totalCredit!: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'posted_by_id', type: 'uuid', nullable: true })
  postedById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
