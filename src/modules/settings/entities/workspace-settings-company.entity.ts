// src/modules/settings/entities/workspace-settings-company.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workspace_settings_company')
@Unique('uq_workspace_settings_company_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_workspace_settings_company_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class WorkspaceSettingsCompanyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 120 })
  legalName!: string;

  @Column({ name: 'public_name', type: 'varchar', length: 80 })
  publicName!: string;

  @Column({ name: 'workspace_name', type: 'varchar', length: 63 })
  workspaceName!: string;

  @Column({ name: 'tax_id_type', type: 'varchar', length: 20 })
  taxIdType!: 'cnpj' | 'ein' | 'other';

  @Column({
    name: 'tax_id_custom_label',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  taxIdCustomLabel!: string | null;

  @Column({ name: 'tax_id', type: 'varchar', length: 40 })
  taxId!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({
    name: 'primary_color',
    type: 'varchar',
    length: 7,
    default: '#2563EB',
  })
  primaryColor!: string;

  @Column({
    name: 'secondary_color',
    type: 'varchar',
    length: 7,
    default: '#0F172A',
  })
  secondaryColor!: string;

  @Column({
    name: 'support_email',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  supportEmail!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website!: string | null;

  @Column({
    name: 'instagram_handle',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  instagramHandle!: string | null;

  @Column({
    name: 'facebook_url',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  facebookUrl!: string | null;

  @Column({
    name: 'linkedin_url',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  linkedinUrl!: string | null;

  @Column({ type: 'varchar', length: 80 })
  country!: string;

  @Column({
    name: 'state_region',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  stateRegion!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city!: string | null;

  @Column({
    name: 'address_line1',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  addressLine1!: string | null;

  @Column({
    name: 'address_line2',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  addressLine2!: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  industry!: string | null;

  @Column({ name: 'company_size', type: 'varchar', length: 40, nullable: true })
  companySize!: string | null;

  @Column({ type: 'varchar', length: 80, default: 'America/Sao_Paulo' })
  timezone!: string;

  @Column({ name: 'brand_logo_url', type: 'text', nullable: true })
  brandLogoUrl!: string | null;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({ name: 'logo_path', type: 'varchar', length: 255, nullable: true })
  logoPath!: string | null;

  @Column({
    name: 'brand_logo_asset_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  brandLogoAssetKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
