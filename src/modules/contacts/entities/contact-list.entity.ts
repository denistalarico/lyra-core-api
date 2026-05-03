import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type ContactListVisibility = 'private' | 'workspace';

@Entity('contact_lists')
@Unique('uq_contact_lists_workspace_name', ['workspaceId', 'name'])
@Index('idx_contact_lists_tenant_workspace', ['tenantId', 'workspaceId'])
export class ContactListEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 7, default: '#2563EB' })
  color!: string;

  @Column({ name: 'parent_list_id', type: 'uuid', nullable: true })
  parentListId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'workspace' })
  visibility!: ContactListVisibility;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
