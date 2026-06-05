import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  AgencyClientHealthStatus,
  AgencyClientLifecycleStage,
  AgencyClientStatus,
} from '../enums';

@Entity('agency_clients')
export class AgencyClient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 180 })
  displayName!: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 180, nullable: true })
  legalName!: string | null;

  @Column({ type: 'varchar', length: 40, default: AgencyClientStatus.Active })
  status!: AgencyClientStatus;

  @Column({
    name: 'lifecycle_stage',
    type: 'varchar',
    length: 40,
    default: AgencyClientLifecycleStage.Active,
  })
  lifecycleStage!: AgencyClientLifecycleStage;

  @Column({
    name: 'health_status',
    type: 'varchar',
    length: 40,
    default: AgencyClientHealthStatus.Unknown,
  })
  healthStatus!: AgencyClientHealthStatus;

  @Column({ type: 'varchar', length: 120, nullable: true })
  segment!: string | null;

  @Column({ name: 'account_owner_id', type: 'uuid', nullable: true })
  accountOwnerId!: string | null;

  @Column({ name: 'managed_tenant_id', type: 'uuid', nullable: true })
  managedTenantId!: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
