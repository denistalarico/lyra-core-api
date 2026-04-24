import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type WorkspaceUserRole = 'owner' | 'admin' | 'manager' | 'member';
export type WorkspaceUserStatus = 'active' | 'invited' | 'inactive';

@Entity('workspace_users')
@Unique('uq_workspace_users_workspace_email', ['workspaceId', 'email'])
@Index('idx_workspace_users_tenant_workspace', ['tenantId', 'workspaceId'])
export class WorkspaceUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 160 })
  email!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: WorkspaceUserRole;

  @Column({ type: 'varchar', length: 20 })
  status!: WorkspaceUserStatus;

  @Column({ name: 'last_access', type: 'varchar', length: 120, default: '' })
  lastAccess!: string;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt!: Date | null;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
