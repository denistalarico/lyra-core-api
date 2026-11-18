import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  FiscalCertificateMeta,
  FiscalIntakeData,
  FiscalIntakeScope,
  FiscalIntakeStatus,
} from '../fiscal-intake.types';

/**
 * One link sent to the accountant (§4.4). The pure token only exists in the
 * link; the row keeps its sha256. A submission waits here (ciphertext
 * included) until the agency approves it into `finance_fiscal_profiles`; on
 * approval or rejection the ciphertext is wiped from this row.
 */
@Entity('fiscal_intake_requests')
export class FiscalIntakeRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 20, default: 'full' })
  scope!: FiscalIntakeScope;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: FiscalIntakeStatus;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, select: false })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({
    name: 'recipient_name',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  recipientName!: string | null;

  @Column({
    name: 'recipient_email',
    type: 'varchar',
    length: 254,
    nullable: true,
  })
  recipientEmail!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  data!: FiscalIntakeData | null;

  @Column({
    name: 'certificate_encrypted',
    type: 'bytea',
    nullable: true,
    select: false,
  })
  certificateEncrypted!: Buffer | null;

  @Column({
    name: 'certificate_password_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  certificatePasswordEncrypted!: string | null;

  @Column({
    name: 'municipal_portal_password_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  municipalPortalPasswordEncrypted!: string | null;

  @Column({ name: 'certificate_key_version', type: 'integer', nullable: true })
  certificateKeyVersion!: number | null;

  @Column({ name: 'certificate_meta', type: 'jsonb', nullable: true })
  certificateMeta!: FiscalCertificateMeta | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
