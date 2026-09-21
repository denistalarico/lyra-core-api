import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const AGENCY_CLIENT_COMPANY_CONTEXT_STATUSES = [
  'active',
  'inactive',
  'archived',
] as const;

export type AgencyClientCompanyContextStatus =
  (typeof AGENCY_CLIENT_COMPANY_CONTEXT_STATUSES)[number];

@Entity('agency_client_company_contexts')
@Unique('UQ_agency_client_company_contexts_client_company', [
  'agencyClientId',
  'companyContactId',
])
@Index('IDX_agency_client_company_contexts_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('UQ_agency_client_company_contexts_active_primary', ['agencyClientId'], {
  unique: true,
  where: `"is_primary" = true AND "status" = 'active' AND "archived_at" IS NULL`,
})
export class AgencyClientCompanyContext {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid' })
  agencyClientId!: string;

  @Column({ name: 'company_contact_id', type: 'uuid' })
  companyContactId!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: AgencyClientCompanyContextStatus;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
}
