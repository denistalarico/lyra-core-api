import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { SocialApprovalStage } from './social-approval-request.entity';

export type SocialApprovalActorType = 'user' | 'system';
export type SocialApprovalDecision = 'approved' | 'changes_requested';

@Entity('social_approval_stage_decisions')
@Index('IDX_social_approval_stage_decisions_request_created', ['approvalRequestId', 'createdAt'])
@Check('CK_social_approval_stage_decisions_stage', '"stage" IN (\'internal\', \'client\')')
@Check('CK_social_approval_stage_decisions_kind', '"decision" IN (\'approved\', \'changes_requested\')')
@Check('CK_social_approval_stage_decisions_actor', `("actor_type" = 'user' AND "actor_user_id" IS NOT NULL) OR ("actor_type" = 'system' AND "actor_user_id" IS NULL)`)
export class SocialApprovalStageDecisionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'approval_request_id', type: 'uuid' }) approvalRequestId!: string;
  @Column({ type: 'varchar', length: 16 }) stage!: SocialApprovalStage;
  @Column({ type: 'varchar', length: 32 }) decision!: SocialApprovalDecision;
  @Column({ name: 'actor_type', type: 'varchar', length: 16 }) actorType!: SocialApprovalActorType;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId!: string | null;
  @Column({ name: 'comment_id', type: 'uuid', nullable: true }) commentId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
