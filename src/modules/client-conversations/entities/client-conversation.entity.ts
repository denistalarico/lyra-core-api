import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ClientConversationKind,
  ClientConversationStatus,
} from '../client-conversation.types';

/**
 * CCOM1 — a conversation between the agency and one Company Context.
 *
 * WHY THE FULL SCOPE TUPLE IS NOT NULL
 * ------------------------------------
 * `(tenant_id, workspace_id, agency_client_id, company_context_id)` is the
 * platform's unit of scope, and the Client Area's authorization formula is
 * stated in exactly those terms. The Agency chat channel carries only
 * `related_client_id` — half the key — which is the concrete reason this is a
 * separate table (CCOM0 §33). A nullable scope column has cost this repo
 * before (`legacy_unassigned`), so every one of the four is required and the
 * composite FK makes the database agree that they describe one company.
 *
 * WHY AN ID OF ITS OWN
 * --------------------
 * V1 allows exactly one active conversation per company, enforced by a partial
 * unique index on `(company_context_id) WHERE status = 'active'` rather than by
 * making the company the primary key (CCOM1 §4). A second channel later is then
 * a new row; had the company been the key, it would have been a migration of
 * every foreign key pointing here.
 */
@Entity('client_conversations')
@Index('IDX_client_conversations_company', [
  'tenantId',
  'workspaceId',
  'companyContextId',
  'status',
])
@Index('IDX_client_conversations_client', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'status',
])
@Index('UQ_client_conversations_active_default', ['companyContextId', 'kind'], {
  unique: true,
  where: `"status" = 'active'`,
})
export class ClientConversationEntity {
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

  @Column({ type: 'varchar', length: 16, default: 'default' })
  kind!: ClientConversationKind;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: ClientConversationStatus;

  /**
   * Denormalized from the newest message, so a conversation list can order by
   * recency without a correlated subquery per row. It is a cache of an
   * append-only fact and never an authorization input.
   */
  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
}
