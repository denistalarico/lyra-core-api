import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { InboxScopeKind } from '../inbox-company-scope';
import type {
  MetaCommentContentKind,
  MetaCommentSurface,
} from '../channels/meta/adapters/meta-comment.normalizer';

export type InboxCommentDirection = 'inbound' | 'outbound';
export type InboxCommentStatus = 'active' | 'hidden' | 'deleted';
export type InboxCommentReplyStatus = 'unanswered' | 'answered' | 'ignored';
export type InboxCommentPrivateReplyStatus = 'none' | 'sent' | 'failed';

/**
 * A comment on an Instagram or Facebook post/ad (IX3, D-IX-5), received by the
 * LeadFlow Meta app and owned by the Inbox — not the Social module.
 *
 * Scoped like `inbox_conversations`: the row inherits the scope of the Inbox
 * channel (Instagram or Messenger) whose account received it. Outbound rows are
 * our own replies; the provider echoes them back on the webhook and the UNIQUE
 * key is what keeps that echo from becoming a second row.
 */
@Entity('inbox_comments')
@Index(
  'uq_inbox_comments_external',
  ['tenantId', 'workspaceId', 'channelId', 'externalCommentId'],
  { unique: true },
)
export class InboxCommentEntity {
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

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ type: 'varchar', length: 16 })
  surface!: MetaCommentSurface;

  /** Page id (Facebook) or Instagram account id: the webhook's `entry.id`. */
  @Column({ name: 'account_external_id', type: 'varchar', length: 180 })
  accountExternalId!: string;

  @Column({ name: 'external_comment_id', type: 'varchar', length: 180 })
  externalCommentId!: string;

  @Column({
    name: 'external_parent_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalParentId!: string | null;

  @Column({
    name: 'external_content_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalContentId!: string | null;

  @Column({ name: 'content_kind', type: 'varchar', length: 16 })
  contentKind!: MetaCommentContentKind;

  @Column({
    name: 'ad_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  adExternalId!: string | null;

  @Column({ name: 'ad_title', type: 'varchar', length: 240, nullable: true })
  adTitle!: string | null;

  @Column({
    name: 'author_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  authorExternalId!: string | null;

  @Column({
    name: 'author_username',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  authorUsername!: string | null;

  @Column({ name: 'author_name', type: 'varchar', length: 240, nullable: true })
  authorName!: string | null;

  @Column({ name: 'author_avatar_url', type: 'text', nullable: true })
  authorAvatarUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'varchar', length: 16 })
  direction!: InboxCommentDirection;

  /** Our user, when a person replied through the Lyra. */
  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId!: string | null;

  /** Our agent, when the comment agent replied (D-IX-6). */
  @Column({ name: 'author_agent_id', type: 'uuid', nullable: true })
  authorAgentId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: InboxCommentStatus;

  @Column({
    name: 'reply_status',
    type: 'varchar',
    length: 16,
    default: 'unanswered',
  })
  replyStatus!: InboxCommentReplyStatus;

  @Column({
    name: 'private_reply_status',
    type: 'varchar',
    length: 16,
    default: 'none',
  })
  privateReplyStatus!: InboxCommentPrivateReplyStatus;

  @Column({ name: 'private_reply_at', type: 'timestamptz', nullable: true })
  privateReplyAt!: Date | null;

  @Column({
    name: 'private_reply_conversation_id',
    type: 'uuid',
    nullable: true,
  })
  privateReplyConversationId!: string | null;

  @Column({ name: 'provider_created_at', type: 'timestamptz', nullable: true })
  providerCreatedAt!: Date | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  /** Outbound only: the key the caller sent, so a retry never posts twice. */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 220,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
