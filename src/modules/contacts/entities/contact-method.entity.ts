import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ContactMethodType =
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'instagram'
  | 'website'
  | 'other';

@Entity('contact_methods')
@Index('idx_contact_methods_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_contact_methods_contact', ['contactId'])
@Index('idx_contact_methods_contact_type', ['contactId', 'type'])
export class ContactMethodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ type: 'varchar', length: 30 })
  type!: ContactMethodType;

  @Column({ type: 'varchar', length: 255 })
  value!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  label!: string | null;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
