import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ContactAddressType = 'main' | 'billing' | 'shipping' | 'other';

@Entity('contact_addresses')
@Index('idx_contact_addresses_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_contact_addresses_contact', ['contactId'])
export class ContactAddressEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ type: 'varchar', length: 30, default: 'main' })
  type!: ContactAddressType;

  @Column({ type: 'varchar', length: 160, nullable: true })
  street!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  number!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  complement!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  state!: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  country!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
