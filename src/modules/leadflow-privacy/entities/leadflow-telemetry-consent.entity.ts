import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';

@Index('IDX_lf_telemetry_consents_scope_time', [
  'tenantId',
  'workspaceId',
  'contextType',
  'agencyClientId',
  'occurredAt',
])
@Entity('leadflow_telemetry_consents')
export class LeadFlowTelemetryConsentEntity {
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

  @Column({ name: 'notice_id', type: 'uuid', nullable: true })
  noticeId!: string | null;

  @Column({ name: 'purpose_key', type: 'varchar', length: 80 })
  purposeKey!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: 'opted_in' | 'opted_out' | 'erased';

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'reason_code', type: 'varchar', length: 40, nullable: true })
  reasonCode!: string | null;

  @Column({ name: 'notice_version', type: 'integer', nullable: true })
  noticeVersion!: number | null;

  @Column({
    name: 'notice_content_hash',
    type: 'char',
    length: 64,
    nullable: true,
  })
  noticeContentHash!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
