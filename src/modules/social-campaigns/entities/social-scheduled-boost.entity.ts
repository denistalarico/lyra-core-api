import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * `pending` waits for its publication to be published; `executing` is claimed
 * by the runner; `executed` produced a boost request (its own status says
 * whether Meta accepted it); `failed` never reached a request or was refused;
 * `cancelled` was withdrawn by a person or by the publication failing.
 */
export type SocialScheduledBoostStatus =
  | 'pending'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled';

/**
 * A boost authorized at scheduling time (Planner) and executed by the
 * campaigns runner once its publication is published. The authorization
 * (person + spend acknowledgement) is recorded here because the Meta call
 * itself happens later, without anyone on the screen.
 */
@Entity('social_scheduled_boosts')
@Index('IDX_social_scheduled_boosts_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Check(
  'CK_social_scheduled_boosts_status',
  `"status" IN ('pending', 'executing', 'executed', 'failed', 'cancelled')`,
)
export class SocialScheduledBoostEntity {
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

  @Column({ name: 'publication_id', type: 'uuid' })
  publicationId!: string;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @Column({ name: 'boost_template_id', type: 'uuid' })
  boostTemplateId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: SocialScheduledBoostStatus;

  @Column({ name: 'boost_request_id', type: 'uuid', nullable: true })
  boostRequestId!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 120, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'spend_acknowledged_at', type: 'timestamptz' })
  spendAcknowledgedAt!: Date;

  @Column({ name: 'authorized_by_id', type: 'uuid', nullable: true })
  authorizedById!: string | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
