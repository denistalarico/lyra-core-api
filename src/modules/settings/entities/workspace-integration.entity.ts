// src/modules/settings/entities/workspace-integration.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('workspace_integrations')
@Unique('uq_workspace_integrations_workspace_item', ['workspaceId', 'itemId'])
@Index('idx_workspace_integrations_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
export class WorkspaceIntegrationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'item_id', type: 'varchar', length: 80 })
  itemId!: string;

  @Column({ type: 'varchar', length: 30 })
  category!: 'integration' | 'app';

  @Column({ type: 'varchar', length: 30 })
  status!: 'available' | 'connected' | 'coming_soon' | 'requires_setup';

  @Column({ name: 'is_installed', type: 'boolean', default: false })
  isInstalled!: boolean;

  @Column({ name: 'is_pinned', type: 'boolean', default: false })
  isPinned!: boolean;

  @Column({ name: 'sidebar_order', type: 'int', nullable: true })
  sidebarOrder!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
