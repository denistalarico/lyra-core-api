import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  ClientConversationMessageKind,
  ClientConversationMessageMetadata,
  ClientConversationSurface,
} from '../client-conversation.types';

/**
 * CCOM1 — a message in a client conversation.
 *
 * APPEND-ONLY IN V1 (CCOM1 §47)
 * -----------------------------
 * There is no edit and no delete route. `deleted_at`/`edited_at` are not
 * declared, because a column that nothing writes is an invitation to assume it
 * works. The reasoning: this conversation is the record of what was said to a
 * party *outside* the agency, and the Agency chat's own edit/delete path has no
 * audit trail of the prior text. Shipping mutation here only for parity would
 * mean the client could be told something and have it silently rewritten.
 * Reinstating it later is an additive migration plus an audited history table.
 *
 * WHAT IS CANONICAL HERE AND WHAT IS NOT
 * --------------------------------------
 * Free messages are canonical in this table. Approval comments are NOT copied
 * into it: they stay canonical in `social_approval_comments`, with their own
 * CHECK constraints and `visibility` default, and CCOM2 projects them into the
 * timeline on read (CCOM0 §13, CCOM1 §13). No text row is ever duplicated.
 *
 * `sender_user_id` is nullable so the platform can speak (`kind='system'`,
 * sender NULL) — the pattern `TeamChatCardPostService` already uses for an
 * author-less post. A CHECK constraint ties that to `sender_surface='agency'`,
 * so a client-attributed message always has a person behind it.
 */
@Entity('client_conversation_messages')
@Index('IDX_client_conversation_messages_keyset', [
  'conversationId',
  'createdAt',
  'id',
])
@Index('IDX_client_conversation_messages_scope', [
  'tenantId',
  'workspaceId',
  'companyContextId',
])
export class ClientConversationMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid' })
  agencyClientId!: string;

  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'sender_surface', type: 'varchar', length: 16 })
  senderSurface!: ClientConversationSurface;

  /** NULL only for a platform-authored `system` message. */
  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId!: string | null;

  /**
   * Plain text, never HTML. Rich content belongs in `metadata` and is rendered
   * by a component the client owns; escaping every body is what keeps a chat
   * safe. The body also survives as the preview, search and notification text.
   */
  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'varchar', length: 16, default: 'text' })
  kind!: ClientConversationMessageKind;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: ClientConversationMessageMetadata | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
