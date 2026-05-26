import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceBankAccountType } from '../enums';

@Entity('finance_bank_accounts')
export class FinanceBankAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: FinanceBankAccountType,
    default: FinanceBankAccountType.Checking,
  })
  type!: FinanceBankAccountType;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'BRL' })
  currency!: string;

  @Column({ name: 'bank_name', type: 'varchar', length: 160, nullable: true })
  bankName!: string | null;

  @Column({ name: 'external_reference', type: 'varchar', length: 180, nullable: true })
  externalReference!: string | null;

  @Column({ name: 'opening_balance', type: 'numeric', precision: 14, scale: 2, default: 0 })
  openingBalance!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
