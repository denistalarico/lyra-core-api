import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  FinancePaymentProviderEnvironment,
  FinancePaymentProviderStatus,
  FinancePaymentProviderType,
} from '../enums';

@Entity('finance_payment_providers')
export class FinancePaymentProvider {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'name', type: 'varchar', length: 120 })
  name!: string;

  @Column({
    name: 'provider_type',
    type: 'enum',
    enum: FinancePaymentProviderType,
  })
  providerType!: FinancePaymentProviderType;

  @Column({
    name: 'status',
    type: 'enum',
    enum: FinancePaymentProviderStatus,
    default: FinancePaymentProviderStatus.Draft,
  })
  status!: FinancePaymentProviderStatus;

  @Column({
    name: 'environment',
    type: 'enum',
    enum: FinancePaymentProviderEnvironment,
    default: FinancePaymentProviderEnvironment.Sandbox,
  })
  environment!: FinancePaymentProviderEnvironment;

  @Column({ name: 'is_default_for_customer_payments', type: 'boolean', default: false })
  isDefaultForCustomerPayments!: boolean;

  @Column({ name: 'is_default_for_vendor_payments', type: 'boolean', default: false })
  isDefaultForVendorPayments!: boolean;

  @Column({ name: 'supports_pix', type: 'boolean', default: false })
  supportsPix!: boolean;

  @Column({ name: 'supports_card', type: 'boolean', default: false })
  supportsCard!: boolean;

  @Column({ name: 'supports_boleto', type: 'boolean', default: false })
  supportsBoleto!: boolean;

  @Column({ name: 'supports_bank_slip', type: 'boolean', default: false })
  supportsBankSlip!: boolean;

  @Column({ name: 'supports_bank_transfer', type: 'boolean', default: false })
  supportsBankTransfer!: boolean;

  @Column({ name: 'public_key', type: 'text', nullable: true })
  publicKey!: string | null;

  @Column({ name: 'secret_key_encrypted', type: 'text', nullable: true })
  secretKeyEncrypted!: string | null;

  @Column({ name: 'access_token_encrypted', type: 'text', nullable: true })
  accessTokenEncrypted!: string | null;

  @Column({ name: 'refresh_token_encrypted', type: 'text', nullable: true })
  refreshTokenEncrypted!: string | null;

  @Column({ name: 'webhook_secret_encrypted', type: 'text', nullable: true })
  webhookSecretEncrypted!: string | null;

  @Column({ name: 'external_account_id', type: 'varchar', length: 160, nullable: true })
  externalAccountId!: string | null;

  @Column({ name: 'last_health_check_at', type: 'timestamptz', nullable: true })
  lastHealthCheckAt!: Date | null;

  @Column({ name: 'last_health_check_status', type: 'varchar', length: 80, nullable: true })
  lastHealthCheckStatus!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ name: 'config', type: 'jsonb', default: () => "'{}'::jsonb" })
  config!: Record<string, unknown>;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
