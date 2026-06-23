import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ContactType = 'person' | 'organization';

export type ContactStatus = 'active' | 'inactive' | 'archived';

export type ContactLifecycleStage =
  | 'lead'
  | 'prospect'
  | 'customer'
  | 'partner'
  | 'supplier'
  | 'internal'
  | 'other';

export type ContactSource = string;

export type ContactBusinessMode =
  | 'general'
  | 'service_quote'
  | 'clinic_booking'
  | 'restaurant_order'
  | 'agency_service'
  | 'ecommerce'
  | 'education'
  | 'real_estate'
  | 'other';

@Entity('contacts')
@Index('idx_contacts_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_contacts_workspace_type', ['workspaceId', 'type'])
@Index('idx_contacts_workspace_status', ['workspaceId', 'status'])
@Index('idx_contacts_workspace_lifecycle_stage', [
  'workspaceId',
  'lifecycleStage',
])
@Index('idx_contacts_workspace_source', ['workspaceId', 'source'])
@Index('idx_contacts_company_contact', ['companyContactId'])
export class ContactEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: ContactType;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 80, nullable: true })
  firstName!: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 120, nullable: true })
  lastName!: string | null;

  @Column({ name: 'legal_name', type: 'varchar', length: 180, nullable: true })
  legalName!: string | null;

  @Column({
    name: 'document_type',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  documentType!: string | null;

  @Column({
    name: 'document_number',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  documentNumber!: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 120, nullable: true })
  jobTitle!: string | null;

  @Column({ name: 'company_contact_id', type: 'uuid', nullable: true })
  companyContactId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'manual' })
  source!: ContactSource;

  @Column({ name: 'business_mode', type: 'varchar', length: 40, default: 'general' })
  businessMode!: ContactBusinessMode;

  @Column({ name: 'lifecycle_stage', type: 'varchar', length: 30, default: 'lead' })
  lifecycleStage!: ContactLifecycleStage;

  @Column({ name: 'lifecycle_stages', type: 'text', array: true, default: '{}' })
  lifecycleStages!: ContactLifecycleStage[];

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: ContactStatus;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
