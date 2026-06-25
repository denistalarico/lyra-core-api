import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'archived';

export type QuoteItemType =
  | 'product'
  | 'service'
  | 'plan'
  | 'recurring'
  | 'setup'
  | 'custom';

export type QuoteDiscountType = 'none' | 'fixed' | 'percentage';
export type QuoteTaxType = 'fixed' | 'percentage';

export type QuoteTemplateStatus = 'active' | 'inactive' | 'archived';

export type QuoteTemplateType =
  | 'simple_quote'
  | 'commercial_proposal'
  | 'monthly_service'
  | 'one_time_project'
  | 'premium_consultative'
  | 'custom';

@Entity('quote_templates')
@Index('idx_quote_templates_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_quote_templates_status', ['tenantId', 'workspaceId', 'status'])
@Index('idx_quote_templates_system_type', ['isSystem', 'type'])
export class QuoteTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'simple_quote' })
  type!: QuoteTemplateType;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: QuoteTemplateStatus;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('quote_template_sections')
@Index('idx_quote_template_sections_template', ['templateId'])
export class QuoteTemplateSectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'template_id', type: 'uuid' })
  templateId!: string;

  @Column({ type: 'varchar', length: 80 })
  key!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ name: 'is_required', type: 'boolean', default: false })
  isRequired!: boolean;

  @Column({ name: 'is_visible', type: 'boolean', default: true })
  isVisible!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('quotes')
@Index('idx_quotes_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_quotes_status', ['tenantId', 'workspaceId', 'status'])
@Index('idx_quotes_contact', ['contactId'])
@Index('idx_quotes_company_contact', ['companyContactId'])
@Index('idx_quotes_opportunity', ['opportunityId'])
@Index('idx_quotes_number', ['tenantId', 'workspaceId', 'quoteNumber'], {
  unique: true,
  where: '"quote_number" IS NOT NULL',
})
export class QuoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId!: string | null;

  @Column({ name: 'quote_number', type: 'varchar', length: 40, nullable: true })
  quoteNumber!: string | null;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'varchar', length: 30, default: 'draft' })
  status!: QuoteStatus;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'company_contact_id', type: 'uuid', nullable: true })
  companyContactId!: string | null;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId!: string | null;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil!: string | null;

  @Column({ name: 'subtotal_cents', type: 'int', default: 0 })
  subtotalCents!: number;

  @Column({ name: 'discount_cents', type: 'int', default: 0 })
  discountCents!: number;

  @Column({ name: 'tax_cents', type: 'int', default: 0 })
  taxCents!: number;

  @Column({ name: 'total_cents', type: 'int', default: 0 })
  totalCents!: number;

  @Column({ name: 'recurring_total_cents', type: 'int', default: 0 })
  recurringTotalCents!: number;

  @Column({ name: 'internal_notes', type: 'text', nullable: true })
  internalNotes!: string | null;

  @Column({ name: 'terms_and_conditions', type: 'text', nullable: true })
  termsAndConditions!: string | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'accepted_by_name', type: 'varchar', length: 160, nullable: true })
  acceptedByName!: string | null;

  @Column({ name: 'accepted_by_email', type: 'varchar', length: 180, nullable: true })
  acceptedByEmail!: string | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 240, nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'source_product', type: 'varchar', length: 60, nullable: true })
  sourceProduct!: string | null;

  @Column({ name: 'source_context', type: 'varchar', length: 80, nullable: true })
  sourceContext!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('quote_items')
@Index('idx_quote_items_quote', ['quoteId'])
@Index('idx_quote_items_tenant_workspace', ['tenantId', 'workspaceId'])
export class QuoteItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId!: string;

  @Column({ name: 'sales_item_id', type: 'uuid', nullable: true })
  salesItemId!: string | null;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'service' })
  type!: QuoteItemType;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ name: 'unit_price_cents', type: 'int', default: 0 })
  unitPriceCents!: number;

  @Column({ name: 'setup_price_cents', type: 'int', default: 0 })
  setupPriceCents!: number;

  @Column({ name: 'recurring_price_cents', type: 'int', default: 0 })
  recurringPriceCents!: number;

  @Column({ name: 'discount_type', type: 'varchar', length: 20, default: 'none' })
  discountType!: QuoteDiscountType;

  @Column({ name: 'discount_value', type: 'int', default: 0 })
  discountValue!: number;

  @Column({ name: 'tax_rate_bps', type: 'int', default: 0 })
  taxRateBps!: number;

  @Column({ name: 'tax_type', type: 'varchar', length: 20, default: 'percentage' })
  taxType!: QuoteTaxType;

  @Column({ name: 'tax_value', type: 'int', default: 0 })
  taxValue!: number;

  @Column({ name: 'subtotal_cents', type: 'int', default: 0 })
  subtotalCents!: number;

  @Column({ name: 'discount_cents', type: 'int', default: 0 })
  discountCents!: number;

  @Column({ name: 'tax_cents', type: 'int', default: 0 })
  taxCents!: number;

  @Column({ name: 'total_cents', type: 'int', default: 0 })
  totalCents!: number;

  @Column({ name: 'recurring_total_cents', type: 'int', default: 0 })
  recurringTotalCents!: number;

  @Column({ name: 'recurrence_interval', type: 'varchar', length: 20, nullable: true })
  recurrenceInterval!: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('quote_status_history')
@Index('idx_quote_status_history_quote', ['quoteId'])
@Index('idx_quote_status_history_tenant_workspace', ['tenantId', 'workspaceId'])
export class QuoteStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 30, nullable: true })
  fromStatus!: QuoteStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 30 })
  toStatus!: QuoteStatus;

  @Column({ type: 'varchar', length: 240, nullable: true })
  reason!: string | null;

  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId!: string | null;

  @Column({ name: 'changed_at', type: 'timestamptz', default: () => 'now()' })
  changedAt!: Date;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
}
