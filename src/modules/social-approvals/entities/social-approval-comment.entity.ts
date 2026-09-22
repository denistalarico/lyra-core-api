import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { SocialApprovalActorType } from './social-approval-stage-decision.entity';
import type { SocialApprovalStage } from './social-approval-request.entity';

@Entity('social_approval_comments')
@Index('IDX_social_approval_comments_request_created', [
  'approvalRequestId',
  'createdAt',
])
@Check('CK_social_approval_comments_body', 'btrim("body") <> \'\'')
@Check(
  'CK_social_approval_comments_stage',
  '"stage" IS NULL OR "stage" IN (\'internal\', \'client\')',
)
@Check(
  'CK_social_approval_comments_actor',
  `("actor_type" = 'user' AND "actor_user_id" IS NOT NULL) OR ("actor_type" = 'system' AND "actor_user_id" IS NULL)`,
)
export class SocialApprovalCommentEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'approval_request_id', type: 'uuid' })
  approvalRequestId!: string;
  @Column({ type: 'varchar', length: 16, nullable: true })
  stage!: SocialApprovalStage | null;
  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType!: SocialApprovalActorType;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @Column({ type: 'text' }) body!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
