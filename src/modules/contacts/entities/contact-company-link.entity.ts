import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('contact_company_links')
@Unique('uq_contact_company_links_person_company', [
  'personContactId',
  'companyContactId',
])
@Index('idx_contact_company_links_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_contact_company_links_person', ['personContactId'])
@Index('idx_contact_company_links_company', ['companyContactId'])
@Index('uq_contact_company_links_active_primary', ['personContactId'], {
  unique: true,
  where: `"is_primary" = true AND "status" = 'active'`,
})
export class ContactCompanyLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'person_contact_id', type: 'uuid' })
  personContactId!: string;

  @Column({ name: 'company_contact_id', type: 'uuid' })
  companyContactId!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  role!: string | null;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'inactive' | 'archived';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
