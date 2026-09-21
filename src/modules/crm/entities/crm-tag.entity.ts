import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('crm_tags')
@Index('IDX_crm_tags_company_scope', ['tenantId', 'workspaceId', 'agencyClientId', 'companyContextId'])
export class CrmTagEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId?: string | null;

  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId?: string | null;

  @Column({ name: 'scope_kind', type: 'varchar', length: 24, nullable: true })
  scopeKind?: 'agency' | 'company' | 'legacy_unassigned';

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  slug!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  color!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  icon!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'user' })
  kind!: string;

  @Column({ type: 'varchar', length: 24, default: 'workspace' })
  scope!: string;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_editable', type: 'boolean', default: true })
  isEditable!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
