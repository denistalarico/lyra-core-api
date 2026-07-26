import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Only real attempts are recorded; skips are not deliveries. */
export type PlatformWhatsAppDeliveryStatus = 'sent' | 'failed';

/**
 * The audit + idempotency record of one platform WhatsApp notification attempt.
 *
 * Keyed by `idempotency_key` (unique): the provider refuses to resend once a row
 * for the key is `sent`. It deliberately stores NO credential — never the token —
 * only the sanitized outcome (provider message id, numeric code, short message).
 */
@Entity('platform_whatsapp_notification_deliveries')
@Index('uq_platform_whatsapp_deliveries_key', ['idempotencyKey'], {
  unique: true,
})
export class PlatformWhatsAppNotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 320 })
  idempotencyKey!: string;

  @Column({ name: 'template_key', type: 'varchar', length: 120 })
  templateKey!: string;

  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  @Column({ name: 'subject_type', type: 'varchar', length: 40 })
  subjectType!: string;

  @Column({ name: 'subject_id', type: 'varchar', length: 128 })
  subjectId!: string;

  @Column({ name: 'handoff_cycle_id', type: 'varchar', length: 64 })
  handoffCycleId!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: PlatformWhatsAppDeliveryStatus;

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerMessageId!: string | null;

  @Column({ name: 'provider_code', type: 'varchar', length: 40, nullable: true })
  providerCode!: string | null;

  @Column({
    name: 'sanitized_message',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  sanitizedMessage!: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
