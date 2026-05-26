import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('finance_settings')
export class FinanceSetting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'base_currency', type: 'varchar', length: 3, default: 'BRL' })
  baseCurrency!: string;

  @Column({ name: 'fiscal_country', type: 'varchar', length: 2, default: 'BR' })
  fiscalCountry!: string;

  @Column({ name: 'fiscal_localization', type: 'varchar', length: 80, default: 'br_agency_simplified' })
  fiscalLocalization!: string;

  @Column({ name: 'default_payment_terms_days', type: 'int', default: 7 })
  defaultPaymentTermsDays!: number;

  @Column({ name: 'invoice_terms', type: 'text', nullable: true })
  invoiceTerms!: string | null;

  @Column({ name: 'pix_enabled', type: 'boolean', default: false })
  pixEnabled!: boolean;

  @Column({ name: 'pix_key', type: 'varchar', length: 180, nullable: true })
  pixKey!: string | null;

  @Column({ name: 'auto_generate_recurring_invoices', type: 'boolean', default: false })
  autoGenerateRecurringInvoices!: boolean;

  @Column({ name: 'grace_period_days', type: 'int', default: 3 })
  gracePeriodDays!: number;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
