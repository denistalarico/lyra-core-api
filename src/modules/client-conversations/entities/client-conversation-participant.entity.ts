import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ClientConversationParticipantRole,
  ClientConversationSurface,
} from '../client-conversation.types';

/**
 * CCOM1 — a seat in a conversation.
 *
 * WHY `participant_surface` IS A COLUMN AND NOT A DERIVATION
 * ---------------------------------------------------------
 * Agency operators and client people live in the *same* identity table
 * (`user_security_settings`); `workspace_users` records agency membership, not
 * identity (CCOM0 §6). So a `user_id` alone cannot say which door a person came
 * through, and the same person can hold both seats without collision — which is
 * why the surface is part of the unique key, not a lookup (CCOM1 §6/§54).
 *
 * WHY `membership_id` IS NULLABLE BUT REQUIRED FOR CLIENTS
 * -------------------------------------------------------
 * A client seat must point at the `client_area_memberships` row that justified
 * it, enforced by a CHECK constraint: `client_area` ⇒ NOT NULL, `agency` ⇒
 * NULL. The membership is *evidence*, never an actor, and never a cached
 * permission: every request re-resolves the membership chain, so a revoked
 * membership stops working before anything here changes (CCOM1 §8/§26).
 *
 * WHY NOTHING IS EVER DELETED
 * ---------------------------
 * Revocation sets `left_at` and keeps the row as history (CCOM1 §26). Access is
 * decided by the live membership check, not by the presence of this row, so
 * keeping it costs no authorization and preserves who was in the room.
 */
@Entity('client_conversation_participants')
@Index(
  'UQ_client_conversation_participants_identity',
  ['conversationId', 'participantSurface', 'userId'],
  { unique: true },
)
@Index('IDX_client_conversation_participants_user', [
  'tenantId',
  'participantSurface',
  'userId',
])
@Index('IDX_client_conversation_participants_conversation', [
  'conversationId',
  'leftAt',
])
export class ClientConversationParticipantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;

  @Column({ name: 'participant_surface', type: 'varchar', length: 16 })
  participantSurface!: ClientConversationSurface;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** The `client_area_memberships` row; NULL for an agency seat. */
  @Column({ name: 'membership_id', type: 'uuid', nullable: true })
  membershipId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'member' })
  role!: ClientConversationParticipantRole;

  /**
   * Unread watermark (CCOM1 §44/§45). Canonical and the only read state in this
   * domain: no `message_reads` table is created, because the Agency chat proved
   * that row to be dead write (CCOM0.5 §7). Seeded to `joined_at` so history
   * from before someone joined is history, not unread.
   */
  @Column({ name: 'last_read_at', type: 'timestamptz', nullable: true })
  lastReadAt!: Date | null;

  @Column({ name: 'muted_until', type: 'timestamptz', nullable: true })
  mutedUntil!: Date | null;

  @Column({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
