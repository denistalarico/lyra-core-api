import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  FormSubmissionOutcome,
  FormSubmissionSource,
  FormSubmissionStatus,
  NormalizedSubmission,
} from '../forms.types';

/**
 * Every submission is stored before any CRM write, so a CRM failure never
 * loses a lead and the row can be reprocessed.
 */
@Entity('form_submissions')
@Index('idx_form_submissions_form_created', ['formId', 'createdAt'])
@Index('idx_form_submissions_rate', ['formId', 'ipHash', 'createdAt'])
export class FormSubmissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ name: 'form_id', type: 'uuid' })
  formId!: string;

  @Column({ name: 'schema_version', type: 'int' })
  schemaVersion!: number;

  @Column({ type: 'varchar', length: 16 })
  source!: FormSubmissionSource;

  /** Raw values as received (declared keys only). */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  normalized!: NormalizedSubmission | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attribution!: Record<string, string>;

  @Column({ name: 'client_nonce', type: 'varchar', length: 64, nullable: true })
  clientNonce!: string | null;

  /** F4: Message-ID of the e-mail lead (dedup per form). */
  @Column({
    name: 'email_message_id',
    type: 'varchar',
    length: 998,
    nullable: true,
  })
  emailMessageId!: string | null;

  /** GL1/ML1: provider lead id (Google `lead_id`, Meta `leadgen_id`); unique per form + source. */
  @Column({
    name: 'external_lead_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  externalLeadId!: string | null;

  @Column({ name: 'ip_hash', type: 'varchar', length: 64, nullable: true })
  ipHash!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 400, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'received' })
  status!: FormSubmissionStatus;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  outcome!: FormSubmissionOutcome;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
