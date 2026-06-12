import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  NotificationActionType,
  NotificationActorType,
  NotificationCategory,
  NotificationPriority,
  NotificationProductKey,
} from '../enums';
import { NotificationRecipientEntity } from './notification-recipient.entity';

@Entity('notifications')
@Index('idx_notifications_tenant_workspace_created', [
  'tenantId',
  'workspaceId',
  'createdAt',
])
@Index('idx_notifications_product_module', ['productKey', 'moduleKey'])
@Index('idx_notifications_event_type', ['eventType'])
@Index('idx_notifications_deduplication_key', ['deduplicationKey'])
@Index(
  'uq_notifications_tenant_source_event',
  ['tenantId', 'sourceEventId'],
  { unique: true },
)
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'managed_tenant_id', type: 'uuid', nullable: true })
  managedTenantId!: string | null;

  @Column({ name: 'product_key', type: 'varchar', length: 30 })
  productKey!: NotificationProductKey;

  @Column({ name: 'module_key', type: 'varchar', length: 80 })
  moduleKey!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ type: 'varchar', length: 40 })
  category!: NotificationCategory;

  @Column({
    type: 'varchar',
    length: 20,
    default: NotificationPriority.NORMAL,
  })
  priority!: NotificationPriority;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({
    name: 'action_type',
    type: 'varchar',
    length: 30,
    default: NotificationActionType.NONE,
  })
  actionType!: NotificationActionType;

  @Column({ name: 'action_url', type: 'varchar', length: 500, nullable: true })
  actionUrl!: string | null;

  @Column({ name: 'resource_type', type: 'varchar', length: 80, nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'actor_type', type: 'varchar', length: 30 })
  actorType!: NotificationActorType;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'initiated_by_user_id', type: 'uuid', nullable: true })
  initiatedByUserId!: string | null;

  @Column({ name: 'source_event_id', type: 'varchar', length: 160 })
  sourceEventId!: string;

  @Column({
    name: 'deduplication_key',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  deduplicationKey!: string | null;

  @Column({ name: 'template_key', type: 'varchar', length: 180 })
  templateKey!: string;

  @Column({
    name: 'template_variables',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  templateVariables!: Record<string, unknown>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  metadata!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @OneToMany(
    () => NotificationRecipientEntity,
    (recipient) => recipient.notification,
  )
  recipients!: NotificationRecipientEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
