import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'scheduled_item_reminders' })
@Index('idx_scheduled_item_reminders_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_scheduled_item_reminders_item', ['scheduledItemId'])
@Index('idx_scheduled_item_reminders_status', ['workspaceId', 'status'])
@Index('idx_scheduled_item_reminders_scheduled_at', ['workspaceId', 'scheduledAt'])
export class ScheduledItemReminderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'scheduled_item_id', type: 'uuid' })
  scheduledItemId!: string;

  @Column({ name: 'reminder_type', type: 'varchar', length: 32 })
  reminderType!: string;

  @Column({ name: 'offset_minutes', type: 'integer' })
  offsetMinutes!: number;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: string;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
