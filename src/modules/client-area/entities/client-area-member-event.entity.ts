import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  ClientAreaMemberEventAction,
  ClientAreaRole,
} from '../client-area.types';

export type ClientAreaMemberEventActorSurface = 'agency' | 'client_area';

/**
 * CA2 — append-only audit trail of Client Area invitations and memberships
 * (who invited, resent, revoked, accepted, changed a role or removed whom,
 * for which company, and when). The service only inserts.
 *
 * `actor_user_id` is the Agency operator for management actions and the
 * client person for `invitation_accepted`; it is NULL only for
 * `invitation_acceptance_blocked`, which records a refused acceptance before
 * anyone authenticated.
 */
@Entity('client_area_member_events')
@Index('IDX_client_area_member_events_company', [
  'tenantId',
  'companyContextId',
  'createdAt',
])
export class ClientAreaMemberEventEntity {
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

  @Column({ type: 'varchar', length: 40 })
  action!: ClientAreaMemberEventAction;

  @Column({ name: 'actor_surface', type: 'varchar', length: 16 })
  actorSurface!: ClientAreaMemberEventActorSurface;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'invitation_id', type: 'uuid', nullable: true })
  invitationId!: string | null;

  @Column({ name: 'membership_id', type: 'uuid', nullable: true })
  membershipId!: string | null;

  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId!: string | null;

  @Column({
    name: 'target_email',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  targetEmail!: string | null;

  @Column({
    name: 'previous_role',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  previousRole!: ClientAreaRole | null;

  @Column({ name: 'new_role', type: 'varchar', length: 24, nullable: true })
  newRole!: ClientAreaRole | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
