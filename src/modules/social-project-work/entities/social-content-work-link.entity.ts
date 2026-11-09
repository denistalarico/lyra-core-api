import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const SOCIAL_CONTENT_WORK_STEP_KINDS = [
  'copy',
  'creative',
  'item',
] as const;
export type SocialContentWorkStepKind =
  (typeof SOCIAL_CONTENT_WORK_STEP_KINDS)[number];

/**
 * AR4 — which task and subtask carry one step of a content item (plan §5).
 *
 * `copy` and `creative` are the two subtasks of an item's own task. `item` is
 * the single subtask of `task_created`, which carries both deliveries (F-14).
 */
@Entity('social_content_work_links')
@Index(
  'UQ_social_content_work_links_item_step',
  ['contentItemId', 'stepKind'],
  { unique: true },
)
export class SocialContentWorkLinkEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'plan_id', type: 'uuid' }) planId!: string;
  @Column({ name: 'content_item_id', type: 'uuid' }) contentItemId!: string;
  @Column({ name: 'step_kind', type: 'varchar', length: 16 })
  stepKind!: SocialContentWorkStepKind;
  @Column({ name: 'task_id', type: 'uuid' }) taskId!: string;
  @Column({ name: 'subtask_id', type: 'uuid', nullable: true })
  subtaskId!: string | null;
  /** Last date applied, so a later human change to the deadline is kept. */
  @Column({ name: 'planned_date', type: 'date', nullable: true })
  plannedDate!: string | null;
  /** Set only when the sync cancelled the work (D-25). */
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
