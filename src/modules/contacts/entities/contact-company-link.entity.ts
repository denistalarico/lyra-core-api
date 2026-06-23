import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
