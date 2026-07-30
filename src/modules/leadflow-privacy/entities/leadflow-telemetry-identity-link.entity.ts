import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';

@Index('IDX_lf_telemetry_identity_scope', [
  'tenantId',
  'workspaceId',
  'contextType',
  'agencyClientId',
])
@Index('UQ_lf_telemetry_identity_pseudonym', ['scopePseudonym'], {
  unique: true,
})
@Entity('leadflow_telemetry_identity_links')
export class LeadFlowTelemetryIdentityLinkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'context_type', type: 'varchar', length: 30 })
  contextType!: LeadFlowSettingsContextType;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'scope_pseudonym', type: 'uuid' })
  scopePseudonym!: string;

  @Column({ name: 'last_collected_at', type: 'timestamptz', nullable: true })
  lastCollectedAt!: Date | null;

  @Column({ name: 'opted_out_at', type: 'timestamptz', nullable: true })
  optedOutAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
