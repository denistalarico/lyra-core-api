import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('notification_push_subscriptions')
@Index('idx_notification_push_subscriptions_tenant_user', [
  'tenantId',
  'userId',
])
@Index('uq_notification_push_subscriptions_endpoint', ['endpoint'], {
  unique: true,
})
export class NotificationPushSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  endpoint!: string;

  @Column({ name: 'p256dh_key', type: 'text' })
  p256dhKey!: string;

  @Column({ name: 'auth_key', type: 'text' })
  authKey!: string;

  @Column({ name: 'user_agent', type: 'varchar', length: 200, nullable: true })
  userAgent!: string | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
