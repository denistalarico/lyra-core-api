import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type LeadFlowOperationsActionEventType =
  | 'proposed'
  | 'confirmed'
  | 'cancelled';

@Index('IDX_lf_ops_action_events_action_created', ['actionId', 'createdAt'])
@Index('IDX_lf_ops_action_events_context_created', [
  'tenantId',
  'workspaceId',
  'createdAt',
])
@Entity('leadflow_operations_action_events')
export class LeadFlowOperationsActionEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'action_id', type: 'uuid' })
  actionId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 30 })
  eventType!: LeadFlowOperationsActionEventType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  snapshot!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
