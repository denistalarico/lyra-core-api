import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamLifecycleIntervalUnit, TeamLifecycleStepStatus } from '../enums';

@Entity('team_member_lifecycle_steps')
@Index('idx_team_lifecycle_steps_process', ['tenantId', 'workspaceId', 'processId'])
@Index('idx_team_lifecycle_steps_member', ['tenantId', 'workspaceId', 'memberId'])
export class TeamMemberLifecycleStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'process_id', type: 'uuid' })
  processId!: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId!: string;

  @Column({ name: 'source_config_option_id', type: 'uuid', nullable: true })
  sourceConfigOptionId!: string | null;

  @Column({ name: 'step_type_id', type: 'uuid', nullable: true })
  stepTypeId!: string | null;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'assignee_label', type: 'varchar', length: 180, nullable: true })
  assigneeLabel!: string | null;

  @Column({ name: 'assignee_member_id', type: 'uuid', nullable: true })
  assigneeMemberId!: string | null;

  @Column({ name: 'interval_value', type: 'integer', nullable: true })
  intervalValue!: number | null;

  @Column({ name: 'interval_unit', type: 'varchar', length: 20, nullable: true })
  intervalUnit!: TeamLifecycleIntervalUnit | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ type: 'varchar', length: 20, default: TeamLifecycleStepStatus.NotStarted })
  status!: TeamLifecycleStepStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
