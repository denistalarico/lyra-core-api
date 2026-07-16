import {
  CreateDateColumn,
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import {
  RoomOperationalSource,
  RoomOutboxDeliveryState,
} from '../enums/room-operational.enums';
import type { LeadFlowJsonObject } from '../types/leadflow-agent.types';

@Index('IDX_lf_room_outbox_context_version', [
  'tenantId',
  'workspaceId',
  'roomVersion',
])
@Index('IDX_lf_room_outbox_source_event', [
  'tenantId',
  'workspaceId',
  'source',
  'sourceEventId',
])
@Entity('leadflow_operations_room_event_outbox')
export class OperationsRoomOutboxEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'contract_version', type: 'integer', default: 1 })
  contractVersion!: number;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'room_version', type: 'bigint' })
  roomVersion!: string;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId!: string | null;

  @Column({ name: 'agent_revision', type: 'bigint', nullable: true })
  agentRevision!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 40 })
  source!: RoomOperationalSource;

  @Column({
    name: 'source_event_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  sourceEventId!: string | null;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: LeadFlowJsonObject;

  @Column({
    name: 'delivery_state',
    type: 'varchar',
    length: 20,
    default: RoomOutboxDeliveryState.Pending,
  })
  deliveryState!: RoomOutboxDeliveryState;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'claim_owner', type: 'varchar', length: 120, nullable: true })
  claimOwner!: string | null;

  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'dead_lettered_at', type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
