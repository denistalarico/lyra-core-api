import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialApprovalStageColor } from './social-approval-board-preferences.entity';

export const SOCIAL_APPROVAL_PIECE_KINDS = [
  'plan_table',
  'campaign_table',
  'content_item',
  'standalone',
] as const;
export type SocialApprovalPieceKind =
  (typeof SOCIAL_APPROVAL_PIECE_KINDS)[number];
export type SocialApprovalPieceOrigin =
  | 'social_planner'
  | 'projects'
  | 'approvals';
export type SocialApprovalSendOrder = 'sequential' | 'together';
export type SocialApprovalPieceSourceState = 'active' | 'hidden' | 'posted';
export const SOCIAL_APPROVAL_CARD_ATTRIBUTES = [
  'thumbnail',
  'client',
  'origin',
  'tags',
] as const;
export type SocialApprovalCardDisplay = Partial<
  Record<(typeof SOCIAL_APPROVAL_CARD_ATTRIBUTES)[number], boolean>
>;

export const SOCIAL_APPROVAL_BOARD_COLUMNS = [
  'preparation',
  'internal_review',
  'awaiting_client',
  'changes',
  'approved',
  'finished',
] as const;
export type SocialApprovalBoardColumn =
  (typeof SOCIAL_APPROVAL_BOARD_COLUMNS)[number];

/**
 * AR1 — the card (plan §5). `board_column` and `active_step_id` are a
 * projection recalculated by `SocialApprovalPiecesService`, never an editable
 * state (D-13). A NULL `active_step_id` means "not projected yet".
 */
@Entity('social_approval_pieces')
@Index('UQ_social_approval_pieces_source', ['kind', 'sourceId'], {
  unique: true,
  where: '"source_id" IS NOT NULL',
})
@Index('IDX_social_approval_pieces_board', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'boardColumn',
  'updatedAt',
])
export class SocialApprovalPieceEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ type: 'varchar', length: 24 }) kind!: SocialApprovalPieceKind;
  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId!: string | null;
  @Column({ type: 'varchar', length: 24 }) origin!: SocialApprovalPieceOrigin;
  @Column({ type: 'varchar', length: 255 }) title!: string;
  @Column({
    name: 'send_order',
    type: 'varchar',
    length: 16,
    default: 'sequential',
  })
  sendOrder!: SocialApprovalSendOrder;
  @Column({
    name: 'board_column',
    type: 'varchar',
    length: 24,
    default: 'preparation',
  })
  boardColumn!: SocialApprovalBoardColumn;
  @Column({ name: 'active_step_id', type: 'uuid', nullable: true })
  activeStepId!: string | null;
  @Column({
    name: 'source_state',
    type: 'varchar',
    length: 16,
    default: 'active',
  })
  sourceState!: SocialApprovalPieceSourceState;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
  @Column({ name: 'finished_by_user_id', type: 'uuid', nullable: true })
  finishedByUserId!: string | null;
  @Column({ name: 'finish_reason', type: 'text', nullable: true })
  finishReason!: string | null;
  @Column({ name: 'card_color', type: 'varchar', length: 16, default: 'none' })
  cardColor!: SocialApprovalStageColor;
  @Column({ type: 'jsonb', default: () => `'[]'` }) tags!: string[];
  @Column({ name: 'card_display', type: 'jsonb', default: () => `'{}'` })
  cardDisplay!: SocialApprovalCardDisplay;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
