import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
} from '../enums';
import { NotificationRecipientEntity } from './notification-recipient.entity';

@Entity('notification_deliveries')
@Index(
  'uq_notification_deliveries_recipient_channel',
  ['notificationRecipientId', 'channel'],
  { unique: true },
)
@Index('idx_notification_deliveries_status_scheduled', [
  'status',
  'scheduledAt',
])
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'notification_recipient_id', type: 'uuid' })
  notificationRecipientId!: string;

  @ManyToOne(
    () => NotificationRecipientEntity,
    (recipient) => recipient.deliveries,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'notification_recipient_id' })
  recipient!: NotificationRecipientEntity;

  @Column({ type: 'varchar', length: 30 })
  channel!: NotificationDeliveryChannel;

  @Column({
    type: 'varchar',
    length: 30,
    default: NotificationDeliveryStatus.PENDING,
  })
  status!: NotificationDeliveryStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerMessageId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
