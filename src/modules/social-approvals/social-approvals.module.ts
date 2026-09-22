import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { CreativeAssetEntity, CreativeAssetVersionEntity } from '../social-creative-studio/entities';
import { SocialApprovalCommentEntity, SocialApprovalRequestEntity, SocialApprovalStageDecisionEntity } from './entities';
import { SocialApprovalsController } from './social-approvals.controller';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';
@Module({ imports: [PermissionsModule, TypeOrmModule.forFeature([SocialApprovalRequestEntity, SocialApprovalCommentEntity, SocialApprovalStageDecisionEntity, CreativeAssetEntity, CreativeAssetVersionEntity], 'agency')], controllers: [SocialApprovalsController], providers: [SocialApprovalsService, ApprovalSubjectResolver], exports: [SocialApprovalsService] })
export class SocialApprovalsModule {}
