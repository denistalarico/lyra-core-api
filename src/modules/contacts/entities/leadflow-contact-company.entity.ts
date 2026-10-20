import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/** CA11: one canonical contact belongs to one operational LeadFlow company. Agency connection only. */
@Entity('leadflow_contact_companies')
@Index('idx_leadflow_contact_companies_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
export class LeadFlowContactCompanyEntity {
  @PrimaryColumn({ name: 'contact_id', type: 'uuid' }) contactId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({
    name: 'scope_kind',
    type: 'varchar',
    length: 24,
    default: 'company',
  })
  scopeKind!: 'company';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
