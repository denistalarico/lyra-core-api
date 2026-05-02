import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type ContactCustomFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiselect';

@Entity('contact_custom_fields')
@Unique('uq_contact_custom_fields_workspace_key', ['workspaceId', 'key'])
@Index('idx_contact_custom_fields_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_contact_custom_fields_workspace_active', ['workspaceId', 'isActive'])
export class ContactCustomFieldEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 80 })
  key!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: ContactCustomFieldType;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  options!: unknown | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
