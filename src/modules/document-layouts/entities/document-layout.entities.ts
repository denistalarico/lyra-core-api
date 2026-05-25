import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DocumentLayoutScope =
  | 'global'
  | 'agency'
  | 'sales'
  | 'quotes'
  | 'orders'
  | 'contracts'
  | 'finance'
  | 'reports';

export type DocumentLayoutType =
  | 'essence'
  | 'frame'
  | 'authority'
  | 'flow'
  | 'orbit'
  | 'pulse'
  | 'signature';

export type DocumentLayoutBackgroundType =
  | 'white'
  | 'soft'
  | 'gradient'
  | 'premium_paper';

export type DocumentLayoutPaperFormat = 'a4' | 'letter';

export type DocumentLayoutLogoPosition = 'left' | 'center' | 'right';

export type DocumentLayoutStatus = 'active' | 'inactive' | 'archived';

export type DocumentTemplateDocumentType =
  | 'quote'
  | 'order'
  | 'contract'
  | 'invoice'
  | 'receipt'
  | 'report'
  | 'generic';

@Entity('document_layouts')
export class DocumentLayoutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 40, default: 'agency' })
  scope!: DocumentLayoutScope;

  @Column({ name: 'layout_type', type: 'varchar', length: 40, default: 'essence' })
  layoutType!: DocumentLayoutType;

  @Column({
    name: 'background_type',
    type: 'varchar',
    length: 40,
    default: 'white',
  })
  backgroundType!: DocumentLayoutBackgroundType;

  @Column({ name: 'paper_format', type: 'varchar', length: 20, default: 'a4' })
  paperFormat!: DocumentLayoutPaperFormat;

  @Column({ name: 'font_family', type: 'varchar', length: 80, default: 'Inter' })
  fontFamily!: string;

  @Column({
    name: 'heading_font_family',
    type: 'varchar',
    length: 80,
    default: 'Sora',
  })
  headingFontFamily!: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({
    name: 'logo_position',
    type: 'varchar',
    length: 20,
    default: 'left',
  })
  logoPosition!: DocumentLayoutLogoPosition;

  @Column({ name: 'logo_size', type: 'varchar', length: 20, default: 'medium' })
  logoSize!: string;

  @Column({ name: 'primary_color', type: 'varchar', length: 20, default: '#2563EB' })
  primaryColor!: string;

  @Column({
    name: 'secondary_color',
    type: 'varchar',
    length: 20,
    default: '#0F172A',
  })
  secondaryColor!: string;

  @Column({ name: 'text_color', type: 'varchar', length: 20, default: '#0F172A' })
  textColor!: string;

  @Column({
    name: 'background_color',
    type: 'varchar',
    length: 20,
    default: '#FFFFFF',
  })
  backgroundColor!: string;

  @Column({ name: 'company_name', type: 'varchar', length: 160, nullable: true })
  companyName!: string | null;

  @Column({
    name: 'company_document_label',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  companyDocumentLabel!: string | null;

  @Column({
    name: 'company_document_value',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  companyDocumentValue!: string | null;

  @Column({ name: 'company_address', type: 'text', nullable: true })
  companyAddress!: string | null;

  @Column({ name: 'company_city', type: 'varchar', length: 100, nullable: true })
  companyCity!: string | null;

  @Column({ name: 'company_region', type: 'varchar', length: 100, nullable: true })
  companyRegion!: string | null;

  @Column({
    name: 'company_postal_code',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  companyPostalCode!: string | null;

  @Column({ name: 'company_country', type: 'varchar', length: 100, nullable: true })
  companyCountry!: string | null;

  @Column({ name: 'company_phone', type: 'varchar', length: 80, nullable: true })
  companyPhone!: string | null;

  @Column({ name: 'company_email', type: 'varchar', length: 160, nullable: true })
  companyEmail!: string | null;

  @Column({ name: 'company_website', type: 'varchar', length: 160, nullable: true })
  companyWebsite!: string | null;

  @Column({ type: 'text', nullable: true })
  slogan!: string | null;

  @Column({ name: 'footer_text', type: 'text', nullable: true })
  footerText!: string | null;

  @Column({ name: 'show_qr_code', type: 'boolean', default: false })
  showQrCode!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: DocumentLayoutStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('document_layout_templates')
export class DocumentLayoutTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'layout_id', type: 'uuid', nullable: true })
  layoutId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
  type!: DocumentLayoutType;

  @Column({
    name: 'document_type',
    type: 'varchar',
    length: 40,
    default: 'quote',
  })
  documentType!: DocumentTemplateDocumentType;

  @Column({ name: 'html_template', type: 'text' })
  htmlTemplate!: string;

  @Column({ name: 'css_template', type: 'text' })
  cssTemplate!: string;

  @Column({ name: 'preview_data', type: 'jsonb', default: () => "'{}'::jsonb" })
  previewData!: Record<string, unknown>;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: DocumentLayoutStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
