import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClientAccessLevel } from '../enums/permission.enums';

/**
 * Controls what a user can see/do for a specific agency client
 * (blueprint sections 8.2 and 12.5).
 */
@Entity('agency_client_access')
@Index('idx_agency_client_access_tenant_client', ['tenantId', 'clientId'])
@Index('idx_agency_client_access_tenant_user', ['tenantId', 'userId'])
export class AgencyClientAccessEntity {
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

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'role_key', type: 'varchar', length: 20 })
  roleKey!: string;

  @Column({ name: 'access_level', type: 'varchar', length: 20, default: ClientAccessLevel.Basic })
  accessLevel!: ClientAccessLevel;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
