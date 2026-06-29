import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CalendarEventType =
  | 'internal_meeting'
  | 'client_meeting'
  | 'deadline'
  | 'delivery'
  | 'project_milestone'
  | 'task_due'
  | 'sales_follow_up'
  | 'time_block'
  | 'availability_block'
  | 'holiday';

export type CalendarEventStatus =
  | 'scheduled'
  | 'completed'
  | 'canceled';

export type CalendarEventVisibility =
  | 'workspace'
  | 'team'
  | 'private';

@Entity('calendar_events')
@Index(['tenantId', 'workspaceId'])
@Index(['tenantId', 'workspaceId', 'startsAt'])
@Index(['tenantId', 'workspaceId', 'ownerUserId'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId?: string | null;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 48,
    default: 'internal_meeting',
  })
  eventType!: CalendarEventType;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'scheduled',
  })
  status!: CalendarEventStatus;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'workspace',
  })
  visibility!: CalendarEventVisibility;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ name: 'all_day', type: 'boolean', default: false })
  allDay!: boolean;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId!: string | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @Column({ name: 'sales_opportunity_id', type: 'uuid', nullable: true })
  salesOpportunityId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
