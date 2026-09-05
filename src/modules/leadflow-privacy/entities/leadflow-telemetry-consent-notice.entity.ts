import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index(
  'UQ_lf_telemetry_notice_purpose_version_locale',
  ['purposeKey', 'version', 'locale'],
  { unique: true },
)
@Entity('leadflow_telemetry_consent_notices')
export class LeadFlowTelemetryConsentNoticeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'purpose_key', type: 'varchar', length: 80 })
  purposeKey!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 16, default: 'pt-BR' })
  locale!: string;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  categories!: string[];

  @Column({ name: 'retention_days', type: 'integer' })
  retentionDays!: number;

  @Column({ name: 'k_anonymity_threshold', type: 'integer', default: 5 })
  kAnonymityThreshold!: number;

  @Column({
    name: 'legal_review_status',
    type: 'varchar',
    length: 32,
    default: 'pending',
  })
  legalReviewStatus!: 'pending' | 'provisional' | 'approved' | 'rejected';

  @Column({ type: 'varchar', length: 24, default: 'active' })
  status!: 'active' | 'retired';

  @Column({ name: 'effective_at', type: 'timestamptz' })
  effectiveAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
