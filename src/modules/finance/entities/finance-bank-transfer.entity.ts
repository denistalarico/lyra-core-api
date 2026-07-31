import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceBankTransferStatus } from '../enums';

@Entity('finance_bank_transfers')
export class FinanceBankTransfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'from_bank_account_id', type: 'uuid' })
  fromBankAccountId!: string;

  @Column({ name: 'to_bank_account_id', type: 'uuid' })
  toBankAccountId!: string;

  @Column({ name: 'transfer_date', type: 'date' })
  transferDate!: string;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: FinanceBankTransferStatus.Completed,
  })
  status!: FinanceBankTransferStatus;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt!: Date | null;

  @Column({ name: 'reversed_by_id', type: 'uuid', nullable: true })
  reversedById!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
