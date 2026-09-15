import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialBoostRequestStatus =
  | 'pending_confirmation'
  | 'executing'
  | 'created_paused'
  | 'blocked'
  | 'failed'
  | 'expired';

@Entity('social_boost_requests')
@Index('IDX_social_boost_requests_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'publicationId',
])
@Check(
  'CK_social_boost_requests_status',
  `"status" IN ('pending_confirmation', 'executing', 'created_paused', 'blocked', 'failed', 'expired')`,
)
export class SocialBoostRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ name: 'publication_id', type: 'uuid' })
  publicationId!: string;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @Column({ name: 'boost_template_id', type: 'uuid' })
  boostTemplateId!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: SocialBoostRequestStatus;

  @Column({ name: 'request_id', type: 'uuid', unique: true })
  requestId!: string;

  @Column({
    name: 'confirmation_request_id',
    type: 'uuid',
    nullable: true,
    unique: true,
  })
  confirmationRequestId!: string | null;

  @Column({ name: 'template_snapshot', type: 'jsonb' })
  templateSnapshot!: Record<string, unknown>;

  @Column({ name: 'publication_snapshot', type: 'jsonb' })
  publicationSnapshot!: Record<string, unknown>;

  @Column({ name: 'provider_result', type: 'jsonb', nullable: true })
  providerResult!: Record<string, unknown> | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'proposed_by_id', type: 'uuid', nullable: true })
  proposedById!: string | null;

  @Column({ name: 'confirmed_by_id', type: 'uuid', nullable: true })
  confirmedById!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 120, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
