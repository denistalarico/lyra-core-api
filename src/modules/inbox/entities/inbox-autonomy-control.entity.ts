import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { InboxScopeKind } from '../inbox-company-scope';

@Entity('inbox_autonomy_controls')
@Index('idx_inbox_autonomy_control_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
export class InboxAutonomyControlEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'scope_kind', type: 'varchar', length: 24 })
  scopeKind!: InboxScopeKind;
  @Column({ name: 'reply_enabled', type: 'boolean', default: true })
  replyEnabled!: boolean;
  @Column({ name: 'crm_enabled', type: 'boolean', default: true })
  crmEnabled!: boolean;
  @Column({ name: 'handoff_enabled', type: 'boolean', default: true })
  handoffEnabled!: boolean;
  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt!: Date | null;
  @Column({ name: 'paused_by', type: 'uuid', nullable: true })
  pausedBy!: string | null;
  @Column({ name: 'reason_code', type: 'varchar', length: 80, nullable: true })
  reasonCode!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
