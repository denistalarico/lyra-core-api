import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type GoogleAdsConversionCrm = 'agency_sales' | 'leadflow_crm';
export type GoogleAdsConversionKind = 'qualified' | 'won';
export type GoogleAdsConversionUploadStatus = 'pending' | 'uploaded' | 'failed';

/**
 * GA-CONV (D-G6): one offline click conversion for Google Ads. Unique per
 * (connection, `transaction_id` = `<opportunityId>:<kind>`), which is also the
 * Data Manager `transactionId` Google deduplicates on. Holds ids, the click id,
 * time, value and error codes only: never the lead's name, e-mail or phone.
 */
@Entity('google_ads_conversion_uploads')
export class GoogleAdsConversionUploadEntity {
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

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 16 })
  crm!: GoogleAdsConversionCrm;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: GoogleAdsConversionKind;

  @Column({ name: 'transaction_id', type: 'varchar', length: 80 })
  transactionId!: string;

  @Column({ name: 'form_submission_id', type: 'uuid', nullable: true })
  formSubmissionId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  gclid!: string;

  @Column({ name: 'conversion_action', type: 'varchar', length: 200 })
  conversionAction!: string;

  @Column({ name: 'conversion_at', type: 'timestamptz' })
  conversionAt!: Date;

  @Column({
    name: 'conversion_value',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  conversionValue!: string | null;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, nullable: true })
  currencyCode!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: GoogleAdsConversionUploadStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'error_code', type: 'varchar', length: 120, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 120, nullable: true })
  requestId!: string | null;

  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  uploadedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
