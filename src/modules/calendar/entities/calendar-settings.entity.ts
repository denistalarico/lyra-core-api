import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CalendarDefaultView = 'day' | 'week' | 'month' | 'list';

export type CalendarSharingPermission = 'view' | 'edit';

@Entity('calendar_settings')
@Index(['tenantId', 'workspaceId', 'userId'], { unique: true })
export class CalendarSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId?: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'default_view',
    type: 'varchar',
    length: 24,
    default: 'week',
  })
  defaultView!: CalendarDefaultView;

  @Column({
    name: 'default_event_duration_minutes',
    type: 'int',
    default: 60,
  })
  defaultEventDurationMinutes!: number;

  @Column({ name: 'week_starts_on', type: 'int', default: 1 })
  weekStartsOn!: number;

  @Column({ name: 'workday_start_time', type: 'time', default: '08:00:00' })
  workdayStartTime!: string;

  @Column({ name: 'workday_end_time', type: 'time', default: '18:00:00' })
  workdayEndTime!: string;

  @Column({ name: 'quiet_hours_enabled', type: 'boolean', default: false })
  quietHoursEnabled!: boolean;

  @Column({ name: 'quiet_hours_start_time', type: 'time', default: '22:00:00' })
  quietHoursStartTime!: string;

  @Column({ name: 'quiet_hours_end_time', type: 'time', default: '07:00:00' })
  quietHoursEndTime!: string;

  @Column({ name: 'notifications_enabled', type: 'boolean', default: true })
  notificationsEnabled!: boolean;

  @Column({ name: 'email_notifications_enabled', type: 'boolean', default: true })
  emailNotificationsEnabled!: boolean;

  @Column({ name: 'in_app_notifications_enabled', type: 'boolean', default: true })
  inAppNotificationsEnabled!: boolean;

  @Column({ name: 'default_reminder_minutes', type: 'int', default: 60 })
  defaultReminderMinutes!: number;

  @Column({ name: 'calendar_sharing_enabled', type: 'boolean', default: true })
  calendarSharingEnabled!: boolean;

  @Column({
    name: 'default_sharing_permission',
    type: 'varchar',
    length: 24,
    default: 'view',
  })
  defaultSharingPermission!: CalendarSharingPermission;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
