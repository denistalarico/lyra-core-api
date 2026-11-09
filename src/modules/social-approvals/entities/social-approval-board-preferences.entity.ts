import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialApprovalBoardColumn } from './social-approval-piece.entity';

export const SOCIAL_APPROVAL_STAGE_COLORS = [
  'none',
  'blue',
  'green',
  'amber',
  'rose',
  'violet',
  'teal',
  'cyan',
  'indigo',
  'pink',
  'red',
  'orange',
  'lime',
  'slate',
  'white',
] as const;
export type SocialApprovalStageColor =
  (typeof SOCIAL_APPROVAL_STAGE_COLORS)[number];

export type SocialApprovalStagePreference = {
  color: SocialApprovalStageColor;
  description: string;
};

/**
 * One row per agency: the board spans every context the operator can reach,
 * so its look cannot belong to a single company. Presentation only; the
 * column a card sits in stays a server projection (D-13).
 */
@Entity('social_approval_board_preferences')
@Index('UQ_social_approval_board_preferences', ['tenantId', 'workspaceId'], {
  unique: true,
})
export class SocialApprovalBoardPreferencesEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'stage_order', type: 'jsonb', default: () => `'[]'` })
  stageOrder!: SocialApprovalBoardColumn[];
  @Column({ type: 'jsonb', default: () => `'{}'` })
  stages!: Partial<
    Record<SocialApprovalBoardColumn, SocialApprovalStagePreference>
  >;
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
