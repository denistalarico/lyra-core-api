import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agency_task_checklist_items')
export class AgencyTaskChecklistItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @Column({ type: 'varchar', length: 220 })
  title!: string;

  @Column({ name: 'is_done', type: 'boolean', default: false })
  isDone!: boolean;

  @Column({ type: 'varchar', length: 32, default: 'in_progress' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ name: 'task_type_id', type: 'varchar', length: 120, nullable: true })
  taskTypeId!: string | null;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true, default: null })
  assigneeId!: string | null;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true, default: null })
  dueDate!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
