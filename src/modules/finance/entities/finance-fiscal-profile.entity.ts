import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  FinanceBrazilTaxRegime,
  FinanceFiscalDocumentModel,
  FinanceIbsCbsOperationType,
  FinanceServiceCityOrigin,
} from '../enums';

@Entity('finance_fiscal_profiles')
export class FinanceFiscalProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'fiscal_country', type: 'varchar', length: 2, default: 'BR' })
  fiscalCountry!: string;

  @Column({
    name: 'default_document_model',
    type: 'enum',
    enum: FinanceFiscalDocumentModel,
    default: FinanceFiscalDocumentModel.Nfse,
  })
  defaultDocumentModel!: FinanceFiscalDocumentModel;

  @Column({ name: 'municipal_registration', type: 'varchar', length: 80, nullable: true })
  municipalRegistration!: string | null;

  @Column({ name: 'is_simples_nacional', type: 'boolean', default: false })
  isSimplesNacional!: boolean;

  @Column({
    name: 'brazil_tax_regime',
    type: 'enum',
    enum: FinanceBrazilTaxRegime,
    default: FinanceBrazilTaxRegime.None,
  })
  brazilTaxRegime!: FinanceBrazilTaxRegime;

  @Column({ name: 'has_special_tax_regime', type: 'boolean', default: false })
  hasSpecialTaxRegime!: boolean;

  @Column({ name: 'special_tax_regime_code', type: 'varchar', length: 80, nullable: true })
  specialTaxRegimeCode!: string | null;

  @Column({ name: 'nfse_series', type: 'varchar', length: 20, nullable: true })
  nfseSeries!: string | null;

  @Column({ name: 'next_rps_number', type: 'integer', nullable: true })
  nextRpsNumber!: number | null;

  @Column({ name: 'next_batch_number', type: 'integer', nullable: true })
  nextBatchNumber!: number | null;

  @Column({ name: 'cnae', type: 'varchar', length: 20, nullable: true })
  cnae!: string | null;

  @Column({ name: 'city_service_code', type: 'varchar', length: 80, nullable: true })
  cityServiceCode!: string | null;

  @Column({ name: 'city_taxation_code', type: 'varchar', length: 80, nullable: true })
  cityTaxationCode!: string | null;

  @Column({ name: 'iss_rate', type: 'numeric', precision: 8, scale: 4, default: 0 })
  issRate!: string;

  @Column({ name: 'city_service_description', type: 'text', nullable: true })
  cityServiceDescription!: string | null;

  @Column({
    name: 'service_city_origin',
    type: 'enum',
    enum: FinanceServiceCityOrigin,
    default: FinanceServiceCityOrigin.Provider,
  })
  serviceCityOrigin!: FinanceServiceCityOrigin;

  @Column({ name: 'default_nbs_code', type: 'varchar', length: 80, nullable: true })
  defaultNbsCode!: string | null;

  @Column({ name: 'national_service_code', type: 'varchar', length: 80, nullable: true })
  nationalServiceCode!: string | null;

  @Column({ name: 'has_iss_immunity', type: 'boolean', default: false })
  hasIssImmunity!: boolean;

  @Column({ name: 'certificate_object_key', type: 'varchar', length: 255, nullable: true })
  certificateObjectKey!: string | null;

  @Column({ name: 'certificate_file_name', type: 'varchar', length: 255, nullable: true })
  certificateFileName!: string | null;

  // F5: encrypted with FISCAL_CERT_ENCRYPTION_KEY; never selected by default.
  @Column({ name: 'certificate_password_encrypted', type: 'text', nullable: true, select: false })
  certificatePasswordEncrypted!: string | null;

  @Column({ name: 'certificate_expires_at', type: 'timestamptz', nullable: true })
  certificateExpiresAt!: Date | null;

  @Column({ name: 'is_personal_operation', type: 'boolean', default: false })
  isPersonalOperation!: boolean;

  @Column({ name: 'operation_indicator_code', type: 'varchar', length: 80, nullable: true })
  operationIndicatorCode!: string | null;

  @Column({ name: 'ibs_cbs_cct', type: 'varchar', length: 80, nullable: true })
  ibsCbsCct!: string | null;

  @Column({ name: 'ibs_cbs_cst', type: 'varchar', length: 80, nullable: true })
  ibsCbsCst!: string | null;

  @Column({ name: 'ibs_municipal_rate', type: 'numeric', precision: 8, scale: 4, default: 0 })
  ibsMunicipalRate!: string;

  @Column({ name: 'ibs_state_rate', type: 'numeric', precision: 8, scale: 4, default: 0 })
  ibsStateRate!: string;

  @Column({ name: 'cbs_rate', type: 'numeric', precision: 8, scale: 4, default: 0 })
  cbsRate!: string;

  @Column({
    name: 'ibs_cbs_operation_type',
    type: 'enum',
    enum: FinanceIbsCbsOperationType,
    default: FinanceIbsCbsOperationType.NotApplicable,
  })
  ibsCbsOperationType!: FinanceIbsCbsOperationType;

  @Column({ name: 'deferral_state_percent', type: 'numeric', precision: 8, scale: 4, default: 0 })
  deferralStatePercent!: string;

  @Column({ name: 'deferral_municipal_percent', type: 'numeric', precision: 8, scale: 4, default: 0 })
  deferralMunicipalPercent!: string;

  @Column({ name: 'deferral_cbs_percent', type: 'numeric', precision: 8, scale: 4, default: 0 })
  deferralCbsPercent!: string;

  @Column({ name: 'fiscal_provider', type: 'varchar', length: 80, nullable: true })
  fiscalProvider!: string | null;

  @Column({ name: 'provider_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  providerConfig!: Record<string, unknown>;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  // ── F5 (2026-11-17): accountant intake + A1 certificate (§8) ──────────────
  /** Company identity, address, services, issuer and accountant (no secrets). */
  @Column({ name: 'company_data', type: 'jsonb', default: () => "'{}'::jsonb" })
  companyData!: Record<string, unknown>;

  /** AES-256-GCM (iv|tag|ciphertext) of the .pfx; only FiscalProfileReader decrypts. */
  @Column({ name: 'certificate_encrypted', type: 'bytea', nullable: true, select: false })
  certificateEncrypted!: Buffer | null;

  @Column({ name: 'certificate_key_version', type: 'integer', nullable: true })
  certificateKeyVersion!: number | null;

  /** Holder, CNPJ, issuer, validity and SHA-256 fingerprint. Safe to return. */
  @Column({ name: 'certificate_meta', type: 'jsonb', nullable: true })
  certificateMeta!: Record<string, unknown> | null;

  /** Smallest expiry alert already sent (30 or 7 days); reset on a new certificate. */
  @Column({ name: 'certificate_alert_level', type: 'integer', nullable: true })
  certificateAlertLevel!: number | null;

  @Column({
    name: 'municipal_portal_password_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  municipalPortalPasswordEncrypted!: string | null;

  @Column({ name: 'intake_approved_at', type: 'timestamptz', nullable: true })
  intakeApprovedAt!: Date | null;

  @Column({ name: 'intake_approved_by_user_id', type: 'uuid', nullable: true })
  intakeApprovedByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
