import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const SOCIAL_APPROVAL_STEP_KINDS = [
  'table',
  'copy',
  'creative',
  'text',
  'link',
  'file',
  'media',
] as const;
export type SocialApprovalStepKind =
  (typeof SOCIAL_APPROVAL_STEP_KINDS)[number];

/** AR1 — one thing to approve inside a piece (plan §5). */
@Entity('social_approval_steps')
@Index('UQ_social_approval_steps_piece_kind', ['pieceId', 'kind'], {
  unique: true,
  where: `"kind" IN ('table', 'copy', 'creative')`,
})
@Index('IDX_social_approval_steps_piece', ['pieceId', 'position'])
export class SocialApprovalStepEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'piece_id', type: 'uuid' }) pieceId!: string;
  @Column({ type: 'varchar', length: 16 }) kind!: SocialApprovalStepKind;
  @Column({ type: 'integer', default: 0 }) position!: number;
  @Column({ type: 'varchar', length: 255 }) title!: string;
  @Column({ name: 'current_request_id', type: 'uuid', nullable: true })
  currentRequestId!: string | null;
  /** D-20: the approved revision is no longer the current one. */
  @Column({ name: 'is_stale', type: 'boolean', default: false })
  isStale!: boolean;
  @Column({ name: 'work_project_id', type: 'uuid', nullable: true })
  workProjectId!: string | null;
  @Column({ name: 'work_task_id', type: 'uuid', nullable: true })
  workTaskId!: string | null;
  @Column({ name: 'work_subtask_id', type: 'uuid', nullable: true })
  workSubtaskId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
