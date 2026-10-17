import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_change_events')
@Index('IDX_audit_change_events_client_time', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'occurredAt',
])
export class AuditChangeEventEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid', nullable: true }) workspaceId!:
    | string
    | null;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @Column({ name: 'actor_surface', type: 'varchar', length: 16 })
  actorSurface!: 'agency' | 'client_area' | 'system';
  @Column({ name: 'module_key', type: 'varchar', length: 80 })
  moduleKey!: string;
  @Column({ name: 'entity_type', type: 'varchar', length: 80 })
  entityType!: string;
  @Column({ name: 'entity_id', type: 'uuid', nullable: true }) entityId!:
    | string
    | null;
  @Column({ type: 'varchar', length: 16 }) action!:
    | 'create'
    | 'update'
    | 'delete'
    | 'archive'
    | 'restore'
    | 'state_change';
  @Column({
    name: 'changed_fields',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  changedFields!: string[];
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) diff!: Record<
    string,
    { before: unknown; after: unknown }
  >;
  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  requestId!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip!: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent!: string | null;
  @Column({ type: 'boolean', default: false }) internal!: boolean;
  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt!: Date;
}
