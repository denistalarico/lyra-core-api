import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * CC2G — append-only record of every legacy reconciliation.
 *
 * There is no `update`/`delete` path: the service only inserts. `row_id` is
 * not a foreign key because it addresses roots across ~22 tables.
 */
@Entity('company_context_reconciliation_audits')
@Index('IDX_company_context_reconciliation_audits_row', ['domainKey', 'rowId'])
@Index('IDX_company_context_reconciliation_audits_scope', [
  'tenantId',
  'workspaceId',
  'createdAt',
])
export class CompanyContextReconciliationAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'domain_key', type: 'varchar', length: 120 })
  domainKey!: string;

  @Column({ name: 'row_id', type: 'uuid' })
  rowId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /** Always NULL in CC2G; reserved for a future reassignment workflow. */
  @Column({
    name: 'previous_company_context_id',
    type: 'uuid',
    nullable: true,
  })
  previousCompanyContextId!: string | null;

  @Column({ name: 'assigned_company_context_id', type: 'uuid' })
  assignedCompanyContextId!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'jsonb', nullable: true })
  evidence!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
