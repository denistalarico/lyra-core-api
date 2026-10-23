import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { InboxScopeKind } from '../inbox-company-scope';

export type InboxCommentAgentActionStatus =
  | 'planned'
  | 'claimed'
  | 'applied'
  | 'blocked'
  | 'failed';

/**
 * Ledger of the comment agent's `comment_private_reply` (IX3, D-IX-6).
 *
 * Its own table, not `inbox_governed_actions` (decision of 2026-10-23): that
 * ledger is bound to a conversation, an AgentDecision and an ownership version,
 * and a comment has none of them until the lead answers the private reply. The
 * governance is the same — one row per intent with an idempotency key, the
 * policy and agent version that allowed it, the reply kill switch read at
 * execution time, and a safe error code that is never swallowed.
 *
 * One row per comment (the idempotency key). The 24h limit per author and
 * content is checked under an advisory lock when the row is planned, against
 * `author_external_id` / `external_content_id` kept here for that query.
 */
@Entity('inbox_comment_agent_actions')
@Index(
  'uq_inbox_comment_agent_action_idempotency',
  ['tenantId', 'workspaceId', 'idempotencyKey'],
  { unique: true },
)
export class InboxCommentAgentActionEntity {
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

  @Column({ name: 'scope_kind', type: 'varchar', length: 24 })
  scopeKind!: InboxScopeKind;

  @Column({ name: 'comment_id', type: 'uuid' })
  commentId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({
    name: 'author_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  authorExternalId!: string | null;

  @Column({
    name: 'external_content_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalContentId!: string | null;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @Column({ name: 'agent_version_id', type: 'uuid', nullable: true })
  agentVersionId!: string | null;

  @Column({ name: 'action_type', type: 'varchar', length: 40 })
  actionType!: 'comment_private_reply';

  /** `keywords` or `ad_referral`; never `every_eligible`. */
  @Column({ type: 'varchar', length: 24 })
  trigger!: string;

  @Column({ name: 'reason_code', type: 'varchar', length: 80 })
  reasonCode!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 80 })
  policyVersion!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 220 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: InboxCommentAgentActionStatus;

  /** Public reply text configured on the agent, posted after the private one. */
  @Column({ name: 'public_reply_text', type: 'text', nullable: true })
  publicReplyText!: string | null;

  /** Ids only (messages, comments, provider); never the text sent. */
  @Column({
    name: 'application_result',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  applicationResult!: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
