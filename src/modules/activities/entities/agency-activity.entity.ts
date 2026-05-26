import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ActivityPriority,
  ActivityStatus,
  ActivityType,
  ActivityVisibility,
} from '../enums';

@Entity('agency_activities')
export class AgencyActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 40 })
  type!: ActivityType;

  @Column({ type: 'varchar', length: 80, nullable: true })
  subtype!: string | null;

  @Column({ type: 'varchar', length: 40, default: ActivityStatus.Todo })
  status!: ActivityStatus;

  @Column({ type: 'varchar', length: 40, default: ActivityPriority.Medium })
  priority!: ActivityPriority;

  @Column({ type: 'varchar', length: 180 })
  summary!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'completion_feedback', type: 'text', nullable: true })
  completionFeedback!: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ name: 'start_at', type: 'timestamptz', nullable: true })
  startAt!: Date | null;

  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ name: 'assigned_to_id', type: 'uuid', nullable: true })
  assignedToId!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'completed_by_id', type: 'uuid', nullable: true })
  completedById!: string | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'source_module', type: 'varchar', length: 80, nullable: true })
  sourceModule!: string | null;

  @Column({ type: 'varchar', length: 40, default: ActivityVisibility.Workspace })
  visibility!: ActivityVisibility;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
