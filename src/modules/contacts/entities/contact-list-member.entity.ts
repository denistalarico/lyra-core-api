import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('contact_list_members')
@Unique('uq_contact_list_members_list_contact', ['listId', 'contactId'])
@Index('idx_contact_list_members_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_contact_list_members_list', ['listId'])
@Index('idx_contact_list_members_contact', ['contactId'])
export class ContactListMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'list_id', type: 'uuid' })
  listId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ name: 'added_by_user_id', type: 'uuid', nullable: true })
  addedByUserId!: string | null;

  @Column({ name: 'added_at', type: 'timestamptz', default: () => 'now()' })
  addedAt!: Date;
}
