import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * AP3 — the delivery ledger of the Client Area notification channel.
 *
 * WHY THIS EXISTS INSTEAD OF REUSING `notifications`
 * --------------------------------------------------
 * The shared notification stack is Agency-shaped end to end: it resolves
 * recipient email from `lyra_agency.workspace_users` (a client identity has no
 * row there) and its feed/realtime is read by the Agency UI, which a client
 * never opens. Writing client recipients into it would produce notifications
 * nobody can read and emails to nobody (CA0 §AD). So AP3 delivers to clients
 * by email only, and says so, rather than pretending realtime support exists.
 *
 * WHY A ROW PER (EVENT, RECIPIENT)
 * --------------------------------
 * Idempotency. The unique index is the dedupe: a retry of the same source
 * event for the same person conflicts and is skipped, so a redelivered event
 * cannot mail the same person twice. Per recipient rather than per event
 * because membership is re-checked at delivery time — a person who becomes
 * eligible later must still be reachable for a *different* event without the
 * first one having claimed the whole event id.
 */
@Entity('client_area_approval_notifications')
@Index(
  'UQ_client_area_approval_notifications_event_user',
  ['tenantId', 'sourceEventId', 'userId'],
  { unique: true },
)
@Index('IDX_client_area_approval_notifications_approval', [
  'tenantId',
  'approvalRequestId',
])
export class ClientAreaApprovalNotificationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ name: 'approval_request_id', type: 'uuid' })
  approvalRequestId!: string;

  /** Same value the Agency publisher uses, so both sides dedupe alike. */
  @Column({ name: 'source_event_id', type: 'varchar', length: 255 })
  sourceEventId!: string;
  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  /** The membership's `user_id` — never a Contact, Organization or client. */
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  /** Evidence of the authorization at send time, never the actor. */
  @Column({ name: 'membership_id', type: 'uuid' }) membershipId!: string;

  @Column({ name: 'channel', type: 'varchar', length: 16, default: 'email' })
  channel!: 'email';
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;
  /** Why a claimed row never actually sent (no email on file, send failed). */
  @Column({
    name: 'skipped_reason',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  skippedReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
