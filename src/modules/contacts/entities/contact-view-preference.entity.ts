import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('contact_view_preferences')
@Unique('uq_contact_view_preferences_user_view', [
  'workspaceId',
  'userId',
  'viewKey',
])
@Index('idx_contact_view_preferences_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_contact_view_preferences_user', ['userId'])
export class ContactViewPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'view_key', type: 'varchar', length: 80 })
  viewKey!: string;

  @Column({ name: 'columns_json', type: 'jsonb', default: () => "'[]'::jsonb" })
  columnsJson!: unknown;

  @Column({ name: 'filters_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  filtersJson!: unknown;

  @Column({ name: 'sort_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  sortJson!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
