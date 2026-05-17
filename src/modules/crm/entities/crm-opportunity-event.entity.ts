import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_opportunity_events')
export class CrmOpportunityEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 32, default: 'user' })
  actorType!: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'before_data', type: 'jsonb', default: () => "'{}'::jsonb" })
  beforeData!: Record<string, unknown>;

  @Column({ name: 'after_data', type: 'jsonb', default: () => "'{}'::jsonb" })
  afterData!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  confidence!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
