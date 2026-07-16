import { Column, Entity, Index, UpdateDateColumn } from 'typeorm';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';

@Index('IDX_lf_room_state_context', ['tenantId', 'workspaceId'])
@Index('UQ_lf_room_state_agent', ['tenantId', 'workspaceId', 'agentId'], {
  unique: true,
})
@Index('IDX_lf_room_state_revision', [
  'tenantId',
  'workspaceId',
  'agentRevision',
])
@Entity('leadflow_agent_operational_state')
export class LeadFlowAgentOperationalStateEntity {
  @Column({ name: 'tenant_id', type: 'uuid', primary: true })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', primary: true })
  workspaceId!: string;

  @Column({ name: 'agent_id', type: 'uuid', primary: true })
  agentId!: string;

  @Column({ type: 'varchar', length: 40 })
  status!: RoomAgentOperationalStatus;

  @Column({ name: 'status_since', type: 'timestamptz' })
  statusSince!: Date;

  @Column({ name: 'agent_revision', type: 'bigint', default: 0 })
  agentRevision!: string;

  @Column({ name: 'room_version', type: 'bigint', default: 0 })
  roomVersion!: string;

  @Column({ type: 'varchar', length: 40 })
  source!: RoomOperationalSource;

  @Column({
    name: 'source_event_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  sourceEventId!: string | null;

  @Column({ name: 'reason_code', type: 'varchar', length: 80, nullable: true })
  reasonCode!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
