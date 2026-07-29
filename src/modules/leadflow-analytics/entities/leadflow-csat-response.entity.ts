import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LeadFlowCsatResponseStatus = 'pending' | 'responded' | 'expired';

/**
 * Minimal durable CSAT cycle used by the Phase 8 automation and, later, by
 * Analytics projections.
 *
 * A pending/expired row deliberately carries no score. That makes "no
 * response" a first-class state instead of overloading zero or the absence of
 * a row. The optional domain ids keep the record correlatable without coupling
 * this foundation to a single trigger (appointment, opportunity or conversation).
 */
@Entity('leadflow_csat_responses')
@Index('IDX_lf_csat_scope_status_requested', [
  'tenantId',
  'workspaceId',
  'status',
  'requestedAt',
])
@Index(
  'IDX_lf_csat_contact_requested',
  ['tenantId', 'workspaceId', 'contactId', 'requestedAt'],
  {
    where: '"contact_id" IS NOT NULL',
  },
)
@Index(
  'UQ_lf_csat_scope_idempotency',
  ['tenantId', 'workspaceId', 'idempotencyKey'],
  { unique: true },
)
@Check('CK_lf_csat_status', `"status" IN ('pending', 'responded', 'expired')`)
@Check(
  'CK_lf_csat_score',
  `("score" IS NULL OR ("score" >= 1 AND "score" <= 5))`,
)
@Check(
  'CK_lf_csat_response_state',
  `(
    ("status" = 'responded' AND "score" IS NOT NULL AND "responded_at" IS NOT NULL)
    OR
    ("status" <> 'responded' AND "score" IS NULL AND "responded_at" IS NULL)
  )`,
)
@Check(
  'CK_lf_csat_subject',
  `(
    "contact_id" IS NOT NULL
    OR "conversation_id" IS NOT NULL
    OR "opportunity_id" IS NOT NULL
    OR "appointment_id" IS NOT NULL
  )`,
)
export class LeadFlowCsatResponseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'automation_id', type: 'uuid' })
  automationId!: string;

  @Column({ name: 'automation_run_id', type: 'uuid', nullable: true })
  automationRunId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId!: string | null;

  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: LeadFlowCsatResponseStatus;

  @Column({ type: 'smallint', nullable: true })
  score!: number | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;

  @Column({ name: 'request_source_event_id', type: 'uuid', nullable: true })
  requestSourceEventId!: string | null;

  @Column({ name: 'response_source_event_id', type: 'uuid', nullable: true })
  responseSourceEventId!: string | null;

  @Column({ name: 'response_message_id', type: 'uuid', nullable: true })
  responseMessageId!: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
