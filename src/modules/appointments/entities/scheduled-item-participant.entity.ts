import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'scheduled_item_participants' })
@Index('idx_scheduled_item_participants_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_scheduled_item_participants_item', ['scheduledItemId'])
@Index('idx_scheduled_item_participants_user_id', ['userId'])
@Index('idx_scheduled_item_participants_contact_id', ['contactId'])
export class ScheduledItemParticipantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'scheduled_item_id', type: 'uuid' })
  scheduledItemId!: string;

  @Column({ name: 'participant_type', type: 'varchar', length: 32 })
  participantType!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'external_name', type: 'varchar', length: 180, nullable: true })
  externalName!: string | null;

  @Column({ name: 'external_email', type: 'varchar', length: 180, nullable: true })
  externalEmail!: string | null;

  @Column({ name: 'external_phone', type: 'varchar', length: 80, nullable: true })
  externalPhone!: string | null;

  @Column({ name: 'response_status', type: 'varchar', length: 32, default: 'needs_action' })
  responseStatus!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
