import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type CreativeProductionTaskLinkKind = 'linked' | 'created';

/**
 * CS5-B — the production record of one Planner content item.
 *
 * Holds links, never another owner's state:
 *
 * - the EXPLICIT selection: `selectedVersionId` is the immutable Creative
 *   Version chosen as this item's deliverable. It is never inferred from the
 *   latest version, `current_version_id`, the latest generation or the latest
 *   approval. `selectedCreativeAssetId` is navigation plus the key of the
 *   archive guard; the version is authoritative.
 * - an optional link to existing Agency work. Task/subtask/project ids carry no
 *   FK (another product, hard-deletable by its owner); a missing task is a
 *   read-time fact, not a cascade.
 *
 * There is deliberately no status column: readiness is derived from the
 * Studio, Approvals and the Planner every time it is read.
 */
@Entity('social_creative_productions')
@Unique('UQ_social_creative_productions_content', ['contentItemId'])
@Index('IDX_social_creative_productions_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
])
@Check(
  'CK_social_creative_productions_scope',
  '("agency_client_id" IS NULL) = ("company_context_id" IS NULL)',
)
export class CreativeProductionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'content_item_id', type: 'uuid' }) contentItemId!: string;
  @Column({ name: 'selected_creative_asset_id', type: 'uuid', nullable: true })
  selectedCreativeAssetId!: string | null;
  @Column({ name: 'selected_version_id', type: 'uuid', nullable: true })
  selectedVersionId!: string | null;
  @Column({ name: 'selected_by_id', type: 'uuid', nullable: true })
  selectedById!: string | null;
  @Column({ name: 'selected_at', type: 'timestamptz', nullable: true })
  selectedAt!: Date | null;
  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;
  @Column({ name: 'subtask_id', type: 'uuid', nullable: true })
  subtaskId!: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;
  @Column({
    name: 'task_link_kind',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  taskLinkKind!: CreativeProductionTaskLinkKind | null;
  @Column({ name: 'task_linked_by_id', type: 'uuid', nullable: true })
  taskLinkedById!: string | null;
  @Column({ name: 'task_linked_at', type: 'timestamptz', nullable: true })
  taskLinkedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Event names follow the blueprint's `social.creative.*` taxonomy (§20.2).
 * Approval decisions are NOT here: they are `social.approval.*` facts owned by
 * Approvals, and repeating them would be a second source of truth.
 */
export const CREATIVE_PRODUCTION_EVENT_TYPES = [
  'social.creative.version.selected',
  'social.creative.selection.cleared',
  'social.creative.sent_for_approval',
  'social.creative.task.linked',
  'social.creative.task.created',
  'social.creative.task.unlinked',
  'social.creative.destination.linked',
  'social.creative.planner.reflected',
] as const;
export type CreativeProductionEventType =
  (typeof CREATIVE_PRODUCTION_EVENT_TYPES)[number];

/** Append-only production history (the platform's `<domain>_events` pattern). */
@Entity('social_creative_production_events')
@Index('IDX_social_creative_production_events_content', [
  'contentItemId',
  'occurredAt',
])
export class CreativeProductionEventEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'content_item_id', type: 'uuid' }) contentItemId!: string;
  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: CreativeProductionEventType;
  @Column({ name: 'creative_version_id', type: 'uuid', nullable: true })
  creativeVersionId!: string | null;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;
  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
