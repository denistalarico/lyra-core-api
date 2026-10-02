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
import {
  NotificationInterestReason,
  NotificationRecipientSurface,
} from '../enums';
import { NotificationDeliveryEntity } from './notification-delivery.entity';
import { NotificationEntity } from './notification.entity';

@Entity('notification_recipients')
/**
 * NTF-C1 — the surface is part of the recipient's identity. One human who is
 * both an Agency operator and a Client Area member is the same `user_id` twice
 * on a notification addressed to both audiences; without the surface in this
 * key, the second insert would conflict and that person would silently lose
 * one of the two deliveries.
 */
@Index(
  'uq_notification_recipients_notification_surface_user',
  ['notificationId', 'recipientSurface', 'userId'],
  { unique: true },
)
@Index('idx_notification_recipients_user_created', ['userId', 'createdAt'])
@Index('idx_notification_recipients_surface_user_created', [
  'recipientSurface',
  'userId',
  'createdAt',
])
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

  /**
   * Which surface this person was addressed as. Explicit, never inferred —
   * see `NotificationRecipientSurface`. The column default is `agency`, so
   * every writer predating NTF-C1 keeps producing Agency recipients.
   */
  @Column({
    name: 'recipient_surface',
    type: 'varchar',
    length: 16,
    default: NotificationRecipientSurface.AGENCY,
  })
  recipientSurface!: NotificationRecipientSurface;

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
