import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const SOCIAL_APPROVAL_STATUSES = [
  'draft',
  'awaiting_internal_review',
  'awaiting_client',
  'changes_requested',
  'approved',
  'cancelled',
  'superseded',
] as const;
export type SocialApprovalStatus = (typeof SOCIAL_APPROVAL_STATUSES)[number];
export type SocialApprovalStage = 'internal' | 'client';

@Entity('social_approval_requests')
@Index('IDX_social_approval_requests_scope_created', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'createdAt',
])
@Check(
  'CK_social_approval_requests_scope',
  '"agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL',
)
@Check(
  'CK_social_approval_requests_status',
  `"status" IN (${SOCIAL_APPROVAL_STATUSES.map((item) => `'${item}'`).join(', ')})`,
)
@Check(
  'CK_social_approval_requests_stage',
  "\"current_stage\" IN ('internal', 'client')",
)
export class SocialApprovalRequestEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  /** AgencyClientCompanyContext.id, never a body-authoritative input. */
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ name: 'subject_type', type: 'varchar', length: 80 })
  subjectType!: string;
  @Column({ name: 'subject_id', type: 'uuid' }) subjectId!: string;
  @Column({ name: 'subject_revision_id', type: 'uuid' })
  subjectRevisionId!: string;
  @Column({ name: 'source_module', type: 'varchar', length: 80 })
  sourceModule!: string;
  @Column({ name: 'display_type', type: 'varchar', length: 80 })
  displayType!: string;
  @Column({ type: 'varchar', length: 255 }) title!: string;
  @Column({ name: 'subject_version_label', type: 'varchar', length: 80 })
  subjectVersionLabel!: string;
  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status!: SocialApprovalStatus;
  @Column({
    name: 'current_stage',
    type: 'varchar',
    length: 16,
    default: 'internal',
  })
  currentStage!: SocialApprovalStage;
  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId!: string;
  @Column({ name: 'requested_at', type: 'timestamptz' }) requestedAt!: Date;
  @Column({ name: 'sent_to_client_at', type: 'timestamptz', nullable: true })
  sentToClientAt!: Date | null;
  /** Kept separate from status; AP2/Client Area owns recording it. */
  @Column({
    name: 'client_first_viewed_at',
    type: 'timestamptz',
    nullable: true,
  })
  clientFirstViewedAt!: Date | null;
  @Column({
    name: 'client_last_viewed_at',
    type: 'timestamptz',
    nullable: true,
  })
  clientLastViewedAt!: Date | null;
  /** Agency review is deliberately separate from a Client Area view. */
  @Column({ name: 'internal_first_viewed_at', type: 'timestamptz', nullable: true })
  internalFirstViewedAt!: Date | null;
  @Column({ name: 'internal_last_viewed_at', type: 'timestamptz', nullable: true })
  internalLastViewedAt!: Date | null;
  @Column({ name: 'internal_viewed_by_user_id', type: 'uuid', nullable: true })
  internalViewedByUserId!: string | null;
  @Column({ name: 'client_viewed_by_user_id', type: 'uuid', nullable: true })
  clientViewedByUserId!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
