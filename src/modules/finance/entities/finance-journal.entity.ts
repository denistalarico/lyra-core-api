import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceJournalType } from '../enums';

@Entity('finance_journals')
export class FinanceJournal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'code', type: 'varchar', length: 40 })
  code!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: FinanceJournalType,
  })
  type!: FinanceJournalType;

  @Column({ name: 'default_debit_account_id', type: 'uuid', nullable: true })
  defaultDebitAccountId!: string | null;

  @Column({ name: 'default_credit_account_id', type: 'uuid', nullable: true })
  defaultCreditAccountId!: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
