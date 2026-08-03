import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { LeadFlowAutomationGlobalDefaults } from '../types/leadflow-automation.types';

/** Immutable, append-only global defaults for one LeadFlow Settings context. */
@Index(
  'IDX_lf_automation_global_config_settings_version',
  ['settingsId', 'version'],
  {
    unique: true,
  },
)
@Index('IDX_lf_automation_global_config_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Entity('leadflow_automation_global_config_versions')
export class LeadFlowAutomationGlobalConfigVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  config!: LeadFlowAutomationGlobalDefaults;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
