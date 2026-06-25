import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceBankAccountType } from '../enums';

/**
 * Regional / structured bank identifiers. Kept in a typed JSON column because
 * they are optional, vary per country and are not used in list filtering.
 */
export interface FinanceBankAccountDetails {
  bankCode?: string | null;
  branchNumber?: string | null;
  branchDigit?: string | null;
  accountNumber?: string | null;
  accountDigit?: string | null;
  accountHolderName?: string | null;
  accountHolderDocument?: string | null;
  iban?: string | null;
  swiftBic?: string | null;
  routingNumber?: string | null;
  internationalAccountNumber?: string | null;
  localBankIdentifier?: string | null;
  pixKey?: string | null;
  pixKeyType?: string | null;
}

export interface FinanceBankAccountCardDetails {
  issuer?: string | null;
  lastFour?: string | null;
  creditLimit?: string | null;
  statementClosingDay?: number | null;
  paymentDueDay?: number | null;
}

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

  // Links this bank account to a chart-of-accounts entry for automatic journal entries
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId!: string | null;

  @Column({ name: 'opening_balance', type: 'numeric', precision: 14, scale: 2, default: 0 })
  openingBalance!: string;

  @Column({ name: 'initial_balance_date', type: 'date', nullable: true })
  initialBalanceDate!: string | null;

  // ISO 3166-1 alpha-2 country code of the account (e.g. BR, US, PT).
  @Column({ name: 'country_code', type: 'varchar', length: 2, nullable: true })
  countryCode!: string | null;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ name: 'reconciliation_enabled', type: 'boolean', default: false })
  reconciliationEnabled!: boolean;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'bank_details', type: 'jsonb', default: () => "'{}'::jsonb" })
  bankDetails!: FinanceBankAccountDetails;

  @Column({ name: 'card_details', type: 'jsonb', default: () => "'{}'::jsonb" })
  cardDetails!: FinanceBankAccountCardDetails;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
