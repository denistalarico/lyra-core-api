import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  ClientAreaMembershipStatus,
  ClientAreaRole,
  ClientAreaSelfAccessEventAction,
} from '../client-area.types';

/**
 * PD3 — an Agency identity may enter the Client Area as the agency itself.
 *
 * Deliberately *not* a `client_area_memberships` row: this table has no
 * `agency_client_id` and no `company_context_id`, because the self-context has
 * no AgencyClient, no Company Context and no managed tenant. That absence is
 * the invariant — nothing downstream can be handed an invented company scope.
 *
 * Never deleted: revocation flips `status` and keeps the row as history; a
 * re-grant creates a new row (the active-unique index is partial). No FK on
 * `user_id`, for the same reason as CA1: the platform has no `users` table.
 */
@Entity('client_area_self_access')
@Index('IDX_client_area_self_access_user', ['tenantId', 'userId', 'status'])
@Index('IDX_client_area_self_access_workspace', [
  'tenantId',
  'workspaceId',
  'status',
])
@Index(
  'UQ_client_area_self_access_active',
  ['tenantId', 'workspaceId', 'userId'],
  { unique: true, where: `"status" = 'active'` },
)
export class ClientAreaSelfAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 24 })
  role!: ClientAreaRole;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: ClientAreaMembershipStatus;

  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true })
  grantedByUserId!: string | null;

  @Column({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  revokedByUserId!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * PD3 §29 — append-only audit of self-context activation and access grants.
 * `client_area_member_events` could not be reused: its company columns are
 * `NOT NULL`.
 */
@Entity('client_area_self_access_events')
@Index('IDX_client_area_self_access_events_scope', [
  'tenantId',
  'workspaceId',
  'createdAt',
])
export class ClientAreaSelfAccessEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 40 })
  action!: ClientAreaSelfAccessEventAction;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId!: string | null;

  @Column({
    name: 'previous_role',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  previousRole!: ClientAreaRole | null;

  @Column({ name: 'new_role', type: 'varchar', length: 24, nullable: true })
  newRole!: ClientAreaRole | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
