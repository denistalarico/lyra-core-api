import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CompanyProductKey = 'leadflow' | 'social';
export type CompanyProductStatus =
  | 'active'
  | 'removal_scheduled'
  | 'removal_blocked'
  | 'removed';
export type CompanyRemovalMode = 'immediate' | 'after_last_publication';

@Entity('agency_client_company_products')
@Index('UQ_company_products_live', ['companyContextId', 'productKey'], {
  unique: true,
  where: "status <> 'removed'",
})
export class AgencyClientCompanyProduct {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ name: 'product_key', type: 'varchar', length: 30 })
  productKey!: CompanyProductKey;
  @Column({ type: 'varchar', length: 30 }) status!: CompanyProductStatus;
  @Column({ name: 'activated_at', type: 'timestamptz' }) activatedAt!: Date;
  @Column({ name: 'activated_by', type: 'uuid', nullable: true }) activatedBy!:
    | string
    | null;
  @Column({ name: 'removal_requested_at', type: 'timestamptz', nullable: true })
  removalRequestedAt!: Date | null;
  @Column({ name: 'removal_requested_by', type: 'uuid', nullable: true })
  removalRequestedBy!: string | null;
  @Column({ name: 'removal_mode', type: 'varchar', length: 30, nullable: true })
  removalMode!: CompanyRemovalMode | null;
  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;
  @Column({ name: 'removed_by', type: 'uuid', nullable: true }) removedBy!:
    | string
    | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) metadata!: Record<
    string,
    unknown
  >;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_client_company_product_events')
export class AgencyClientCompanyProductEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId!: string;
  @Column({ name: 'product_key', type: 'varchar', length: 30 })
  productKey!: CompanyProductKey;
  @Column({ type: 'varchar', length: 40 }) action!: string;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) metadata!: Record<
    string,
    unknown
  >;
  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
