import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type UserModuleKey =
  | 'inbox'
  | 'crm'
  | 'agents'
  | 'automations'
  | 'analytics'
  | 'social'
  | 'settings';

export type UserModulePermission = 'admin' | 'manager' | 'member';

@Entity('workspace_user_module_access')
@Unique('uq_workspace_user_module_access_user_module', [
  'workspaceUserId',
  'moduleKey',
])
@Index('idx_workspace_user_module_access_user', ['workspaceUserId'])
export class WorkspaceUserModuleAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'workspace_user_id', type: 'uuid' })
  workspaceUserId!: string;

  @Column({ name: 'module_key', type: 'varchar', length: 30 })
  moduleKey!: UserModuleKey;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 20 })
  permission!: UserModulePermission;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
