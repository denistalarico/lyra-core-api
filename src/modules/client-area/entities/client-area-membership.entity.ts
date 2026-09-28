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
} from '../client-area.types';

/**
 * CA1 — a person (identity of the agency tenant, `user_security_settings`)
 * may represent one Company Context in the Client Area.
 *
 * Never deleted: revocation flips `status` and keeps the row as history; a
 * re-grant creates a new row (the active-unique index is partial). There is
 * no FK on `user_id` because the platform has no `users` table — the service
 * validates the identity in the same tenant.
 */
@Entity('client_area_memberships')
@Index('IDX_client_area_memberships_user', ['tenantId', 'userId', 'status'])
@Index('IDX_client_area_memberships_company', [
  'tenantId',
  'workspaceId',
  'companyContextId',
  'status',
])
@Index('UQ_client_area_memberships_active', ['companyContextId', 'userId'], {
  unique: true,
  where: `"status" = 'active'`,
})
export class ClientAreaMembershipEntity {
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
