import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type WorkspaceUserInvitationRole =
  | 'member'
  | 'manager'
  | 'administrator';
export type WorkspaceUserInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'revoked';

@Entity('workspace_user_invitations')
@Index('idx_workspace_user_invitations_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_workspace_user_invitations_token_hash', ['tokenHash'])
export class WorkspaceUserInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 160 })
  email!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: WorkspaceUserInvitationRole;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: WorkspaceUserInvitationStatus;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'invited_by_user_id', type: 'uuid' })
  invitedByUserId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
