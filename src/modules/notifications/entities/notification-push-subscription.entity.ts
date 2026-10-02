import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationRecipientSurface } from '../enums';

@Entity('notification_push_subscriptions')
@Index('idx_notification_push_subscriptions_tenant_user', [
  'tenantId',
  'userId',
])
/** NTF-C1 §23 — the fan-out query, which is always surface-scoped. */
@Index('idx_notification_push_subscriptions_tenant_surface_user', [
  'tenantId',
  'surface',
  'userId',
])
/**
 * Stays globally unique: a push endpoint identifies one browser's service
 * worker registration, so two rows would mean two owners of one device
 * channel. This is what makes a re-registration from the other surface *move*
 * the row instead of creating a second one (§58).
 */
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

  /**
   * NTF-C1 §22/§24 — which surface registered this subscription. Always set
   * server-side from the authenticated boundary, never from a request body:
   * a client-supplied surface would let one browser opt itself into the other
   * surface's push stream.
   */
  @Column({
    type: 'varchar',
    length: 16,
    default: NotificationRecipientSurface.AGENCY,
  })
  surface!: NotificationRecipientSurface;

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
