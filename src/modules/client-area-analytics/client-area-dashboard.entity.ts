import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ClientAreaLayout } from './client-area-layout.contract';
@Entity('client_area_analytics_dashboards')
export class ClientAreaDashboardEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid' }) agencyClientId!: string;
  @Column({ name: 'company_context_id', type: 'uuid' })
  companyContextId!: string;
  @Column({ name: 'owner_surface', type: 'varchar', length: 16 })
  ownerSurface!: 'agency' | 'client_area';
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ type: 'jsonb' }) layout!: ClientAreaLayout;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
