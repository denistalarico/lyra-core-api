import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('contact_tag_assignments')
@Unique('uq_contact_tag_assignments_contact_tag', ['contactId', 'tagId'])
@Index('idx_contact_tag_assignments_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_contact_tag_assignments_contact', ['contactId'])
@Index('idx_contact_tag_assignments_tag', ['tagId'])
export class ContactTagAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ name: 'tag_id', type: 'uuid' })
  tagId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
