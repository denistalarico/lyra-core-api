import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  ClientConversationAttachmentKind,
  ClientConversationSurface,
} from '../client-conversation.types';

/**
 * CCOM1 — a file in a client conversation.
 *
 * THE OPAQUE REF (CCOM1 §14–§16, inherited from AP3)
 * --------------------------------------------------
 * `storage_key` never leaves the server. There is no `public_url` column, and
 * that absence is the design: the Agency chat stores `/api/assets/{path}` in
 * exactly such a column, which made the path itself the capability until
 * CCOM0.5 bolted a signed grant onto reads. This domain starts where that one
 * is trying to get to — the client is handed only this row's `id`, and bytes
 * come back from an authenticated endpoint that re-derives the path from the
 * conversation it already proved the caller may read.
 *
 * So a caller cannot supply a path: there is no parameter that accepts one.
 * Path traversal is not mitigated here, it is inapplicable (CCOM1 §53).
 *
 * `message_id` is nullable for the upload-then-send order: the file is stored
 * and validated first, then attached when the message is created. An orphan row
 * is unreachable (every read goes through a message in an accessible
 * conversation), so it leaks nothing.
 */
@Entity('client_conversation_attachments')
@Index('IDX_client_conversation_attachments_message', ['messageId'])
@Index('IDX_client_conversation_attachments_conversation', [
  'conversationId',
  'createdAt',
])
export class ClientConversationAttachmentEntity {
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

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId!: string | null;

  @Column({ name: 'uploaded_by_surface', type: 'varchar', length: 16 })
  uploadedBySurface!: ClientConversationSurface;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid' })
  uploadedByUserId!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: ClientConversationAttachmentKind;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({
    name: 'storage_provider',
    type: 'varchar',
    length: 32,
    default: 'minio',
  })
  storageProvider!: string;

  /** Server-side only. Never projected to any surface. */
  @Column({ name: 'storage_key', type: 'text' })
  storageKey!: string;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
