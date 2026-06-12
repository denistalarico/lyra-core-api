import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationInterestReason } from '../enums';
import { NotificationDeliveryEntity } from './notification-delivery.entity';
import { NotificationEntity } from './notification.entity';

@Entity('notification_recipients')
@Index(
  'uq_notification_recipients_notification_user',
  ['notificationId', 'userId'],
  { unique: true },
)
@Index('idx_notification_recipients_user_created', ['userId', 'createdAt'])
@Index('idx_notification_recipients_user_read_archived', [
  'userId',
  'readAt',
  'archivedAt',
])
export class NotificationRecipientEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'notification_id', type: 'uuid' })
  notificationId!: string;

  @ManyToOne(
    () => NotificationEntity,
    (notification) => notification.recipients,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'notification_id' })
  notification!: NotificationEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'interest_reason', type: 'varchar', length: 40 })
  interestReason!: NotificationInterestReason;

  @Column({ name: 'seen_at', type: 'timestamptz', nullable: true })
  seenAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ name: 'dismissed_at', type: 'timestamptz', nullable: true })
  dismissedAt!: Date | null;

  @OneToMany(
    () => NotificationDeliveryEntity,
    (delivery) => delivery.recipient,
  )
  deliveries!: NotificationDeliveryEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
