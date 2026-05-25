import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CalendarRoutineVisibility = 'private';

@Entity('calendar_routine_blocks')
@Index(['tenantId', 'workspaceId'])
@Index(['tenantId', 'workspaceId', 'userId'])
@Index(['tenantId', 'workspaceId', 'userId', 'weekday'])
export class CalendarRoutineBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId?: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 140 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int' })
  weekday!: number;

  @Column({ name: 'start_time', type: 'time' })
  startTime!: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'private',
  })
  visibility!: CalendarRoutineVisibility;

  @Column({ name: 'show_as_busy', type: 'boolean', default: true })
  showAsBusy!: boolean;

  @Column({ name: 'color_key', type: 'varchar', length: 32, nullable: true })
  colorKey!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
