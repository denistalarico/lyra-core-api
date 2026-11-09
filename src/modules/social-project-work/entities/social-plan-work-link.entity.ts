import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const SOCIAL_PLAN_WORK_LINK_MODES = [
  'project_created',
  'project_linked',
  'task_created',
] as const;
export type SocialPlanWorkLinkMode =
  (typeof SOCIAL_PLAN_WORK_LINK_MODES)[number];

/** AR4 — a plan's link to Agency work (plan §5, D-25). One per plan. */
@Entity('social_plan_work_links')
@Index('UQ_social_plan_work_links_plan', ['planId'], { unique: true })
export class SocialPlanWorkLinkEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'plan_id', type: 'uuid' }) planId!: string;
  @Column({ type: 'varchar', length: 24 }) mode!: SocialPlanWorkLinkMode;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ name: 'project_stage_id', type: 'uuid', nullable: true })
  projectStageId!: string | null;
  /** The one task of `task_created`; each item becomes a subtask of it. */
  @Column({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId!: string | null;
  /** Author of the generated work, which has no request of its own. */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
