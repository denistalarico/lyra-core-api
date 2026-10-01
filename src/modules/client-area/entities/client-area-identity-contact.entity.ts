import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * CA4's explicit bridge from an authenticated Client Area identity to the
 * CRM person it represents. It is deliberately not a membership or an
 * authorization grant: memberships remain the sole access authority.
 */
@Entity('client_area_identity_contacts')
@Index('UQ_client_area_identity_contacts_active_user', ['tenantId', 'userId'], {
  unique: true,
  where: `"status" = 'active'`,
})
@Index(
  'UQ_client_area_identity_contacts_active_contact',
  ['tenantId', 'contactId'],
  {
    unique: true,
    where: `"status" = 'active'`,
  },
)
@Index('IDX_client_area_identity_contacts_contact', [
  'tenantId',
  'workspaceId',
  'contactId',
  'status',
])
export class ClientAreaIdentityContactEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: 'active' | 'revoked';

  @Column({ name: 'linked_by_user_id', type: 'uuid', nullable: true })
  linkedByUserId!: string | null;

  @Column({ name: 'linked_at', type: 'timestamptz' })
  linkedAt!: Date;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  revokedByUserId!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
