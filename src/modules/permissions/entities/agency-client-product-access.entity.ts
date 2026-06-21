import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClientProductKey, ClientProductRoleKey } from '../enums/permission.enums';

/**
 * Controls what a user can do within a specific product (LeadFlow, Social, ...)
 * contracted by a managed client (blueprint sections 8.3 and 12.6).
 */
@Entity('agency_client_product_access')
@Index('idx_agency_client_product_access_tenant_client_product', [
  'tenantId',
  'clientId',
  'productKey',
])
@Index('idx_agency_client_product_access_tenant_user', ['tenantId', 'userId'])
export class AgencyClientProductAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ name: 'managed_tenant_id', type: 'uuid', nullable: true })
  managedTenantId!: string | null;

  @Column({ name: 'product_key', type: 'varchar', length: 20 })
  productKey!: ClientProductKey;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 20 })
  roleKey!: ClientProductRoleKey;

  @Column({ name: 'scope_key', type: 'varchar', length: 30, nullable: true })
  scopeKey!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
