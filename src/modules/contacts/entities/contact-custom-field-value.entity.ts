import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('contact_custom_field_values')
@Unique('uq_contact_custom_field_values_contact_field', ['contactId', 'fieldId'])
@Index('idx_contact_custom_field_values_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_contact_custom_field_values_contact', ['contactId'])
@Index('idx_contact_custom_field_values_field', ['fieldId'])
export class ContactCustomFieldValueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ name: 'field_id', type: 'uuid' })
  fieldId!: string;

  @Column({ name: 'value_text', type: 'text', nullable: true })
  valueText!: string | null;

  @Column({ name: 'value_number', type: 'numeric', nullable: true })
  valueNumber!: string | null;

  @Column({ name: 'value_boolean', type: 'boolean', nullable: true })
  valueBoolean!: boolean | null;

  @Column({ name: 'value_date', type: 'date', nullable: true })
  valueDate!: string | null;

  @Column({ name: 'value_json', type: 'jsonb', nullable: true })
  valueJson!: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
