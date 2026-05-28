import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ContractCategory,
  ContractSignatureMode,
  ContractTemplateEditorMode,
  ContractTemplateSource,
  ContractTemplateStatus,
  ContractTargetType,
} from '../enums';

@Entity('agency_contract_templates')
export class ContractTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 60 })
  category!: ContractCategory;

  @Column({ name: 'target_type', type: 'varchar', length: 60 })
  targetType!: ContractTargetType;

  @Column({
    type: 'varchar',
    length: 40,
    default: ContractTemplateStatus.Draft,
  })
  status!: ContractTemplateStatus;

  @Column({
    name: 'default_signature_mode',
    type: 'varchar',
    length: 40,
    default: ContractSignatureMode.Manual,
  })
  defaultSignatureMode!: ContractSignatureMode;

  @Column({ name: 'header_html', type: 'text', nullable: true })
  headerHtml!: string | null;

  @Column({ name: 'body_html', type: 'text' })
  bodyHtml!: string;

  @Column({ name: 'footer_html', type: 'text', nullable: true })
  footerHtml!: string | null;

  @Column({ name: 'locale', type: 'varchar', length: 20, default: 'pt-BR' })
  locale!: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2, nullable: true })
  countryCode!: string | null;

  @Column({
    name: 'jurisdiction_region',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  jurisdictionRegion!: string | null;

  @Column({
    name: 'template_source',
    type: 'varchar',
    length: 40,
    default: ContractTemplateSource.Custom,
  })
  templateSource!: ContractTemplateSource;

  @Column({
    name: 'editor_mode',
    type: 'varchar',
    length: 40,
    default: ContractTemplateEditorMode.Html,
  })
  editorMode!: ContractTemplateEditorMode;

  @Column({ name: 'legal_disclaimer', type: 'text', nullable: true })
  legalDisclaimer!: string | null;

  @Column({
    name: 'variables_schema',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  variablesSchema!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
