import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  FormAfterSubmit,
  FormCapture,
  FormDestination,
  FormFieldsConfig,
  FormGoogleAdsLeads,
  FormInboundEmail,
  FormMetaLeads,
  FormPresentation,
  FormSecurity,
  FormStatus,
  FormTracking,
  FormType,
} from '../forms.types';

/** Forms addon: one form, owned by the agency workspace (D-F11). */
@Entity('forms')
@Index('idx_forms_scope_status', ['tenantId', 'workspaceId', 'status'])
export class FormEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** LeadFlow client whose CRM receives the leads; null = the agency itself. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /** Required with agencyClientId (CC2G: client scope always names the company). */
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  type!: FormType;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: FormStatus;

  @Column({ name: 'public_key', type: 'varchar', length: 40, unique: true })
  publicKey!: string;

  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion!: number;

  @Column({ type: 'jsonb', default: () => `'{"fields":[]}'::jsonb` })
  fields!: FormFieldsConfig;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  presentation!: FormPresentation;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  tracking!: FormTracking;

  @Column({ type: 'jsonb' })
  destination!: FormDestination;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  security!: FormSecurity;

  @Column({ name: 'after_submit', type: 'jsonb', default: () => "'{}'::jsonb" })
  afterSubmit!: FormAfterSubmit;

  /** F4: address that reaches the agency's IMAP box; unique per workspace, lower case. */
  @Column({
    name: 'inbound_email_address',
    type: 'varchar',
    length: 254,
    nullable: true,
  })
  inboundEmailAddress!: string | null;

  @Column({
    name: 'inbound_email',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  inboundEmail!: FormInboundEmail;

  /** GL1: Google Ads lead-form webhook settings and counters (no secret in here). */
  @Column({
    name: 'google_ads_leads',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  googleAdsLeads!: FormGoogleAdsLeads;

  /** ML1: Meta Lead Ads channel (linked Pages/forms, subscription, counters). */
  @Column({
    name: 'meta_leads',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  metaLeads!: FormMetaLeads;

  /** sha256 of the webhook key; never selected by default, so no read of a form can leak it. */
  @Column({
    name: 'google_ads_key_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  googleAdsKeyHash?: string | null;

  /** F3: capture script settings (selector + field mapping). */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  capture!: FormCapture;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
