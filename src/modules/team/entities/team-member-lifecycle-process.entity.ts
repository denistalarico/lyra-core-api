import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamLifecycleProcessStatus, TeamLifecycleProcessType } from '../enums';

@Entity('team_member_lifecycle_processes')
@Index('idx_team_lifecycle_processes_member', ['tenantId', 'workspaceId', 'memberId'])
export class TeamMemberLifecycleProcess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId!: string;

  @Column({ name: 'process_type', type: 'varchar', length: 20 })
  processType!: TeamLifecycleProcessType;

  @Column({ type: 'varchar', length: 24, default: TeamLifecycleProcessStatus.InProgress })
  status!: TeamLifecycleProcessStatus;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

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
