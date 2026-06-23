import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type AgencyBillingChannel = 'email' | 'sms' | 'whatsapp';

export type AgencyBankAccountCurrency = 'BRL' | 'ARS' | 'USD';

@Entity('agency_contact_profiles')
@Unique('uq_agency_contact_profiles_contact', ['workspaceId', 'contactId'])
@Index('idx_agency_contact_profiles_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_agency_contact_profiles_contact', ['contactId'])
export class AgencyContactProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ name: 'avatar_object_key', type: 'varchar', length: 500, nullable: true })
  avatarObjectKey!: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 1000, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  language!: string | null;

  @Column({ name: 'billing_channel', type: 'varchar', length: 30, nullable: true })
  billingChannel!: AgencyBillingChannel | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_contact_identification_types')
@Unique('uq_agency_contact_identification_types_workspace_code', [
  'workspaceId',
  'code',
])
@Index('idx_agency_contact_identification_types_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyContactIdentificationTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_protected', type: 'boolean', default: false })
  isProtected!: boolean;

  @Column({ type: 'integer', default: 0 })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_contact_sources')
@Unique('uq_agency_contact_sources_workspace_code', ['workspaceId', 'code'])
@Index('idx_agency_contact_sources_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class AgencyContactSourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_protected', type: 'boolean', default: false })
  isProtected!: boolean;

  @Column({ type: 'integer', default: 0 })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_banks')
@Unique('uq_agency_banks_workspace_name', ['workspaceId', 'name'])
@Index('idx_agency_banks_tenant_workspace', ['tenantId', 'workspaceId'])
export class AgencyBankEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'bic_swift', type: 'varchar', length: 80, nullable: true })
  bicSwift!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  street!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  number!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  complement!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  state!: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_contact_bank_accounts')
@Index('idx_agency_contact_bank_accounts_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_agency_contact_bank_accounts_contact', ['contactId'])
@Index('idx_agency_contact_bank_accounts_bank', ['bankId'])
export class AgencyContactBankAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ name: 'bank_id', type: 'uuid', nullable: true })
  bankId!: string | null;

  @Column({ name: 'account_number', type: 'varchar', length: 120 })
  accountNumber!: string;

  @Column({ name: 'agency_number', type: 'varchar', length: 80, nullable: true })
  agencyNumber!: string | null;

  @Column({ name: 'holder_name', type: 'varchar', length: 160 })
  holderName!: string;

  @Column({ name: 'can_send_money', type: 'boolean', default: false })
  canSendMoney!: boolean;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: AgencyBankAccountCurrency;

  @Column({ type: 'varchar', length: 120, nullable: true })
  iban!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
