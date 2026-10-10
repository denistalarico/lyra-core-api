import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { AgencyUserSecuritySettingsEntity } from '../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { TeamMember } from '../team/entities/team-member.entity';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import {
  KnowledgeArticlesController,
  KnowledgeAuthorshipController,
  KnowledgeCategoriesController,
  KnowledgeCommentsController,
  KnowledgeQuickNotesController,
  KnowledgeReactionsController,
  KnowledgeVaultController,
} from './controllers';
import { KnowledgeVaultCryptoService } from './crypto/knowledge-vault-crypto.service';
import {
  AgencyKnowledgeArticle,
  AgencyKnowledgeArticleVersion,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeQuickNote,
  AgencyKnowledgeReaction,
  AgencyKnowledgeVaultAccessLog,
  AgencyKnowledgeVaultItem,
  AgencyKnowledgeVaultPermission,
} from './entities';
import {
  HelpArticle,
  HelpCategory,
  HelpCenterController,
  HelpCenterSeedService,
  HelpCenterService,
  HelpTrail,
  HelpTrailArticle,
} from './help';
import {
  KnowledgeArticlesService,
  KnowledgeAuthorshipService,
  KnowledgeCategoriesService,
  KnowledgeCommentsService,
  KnowledgeNotificationPublisher,
  KnowledgeQuickNotesService,
  KnowledgeReactionsService,
  KnowledgeVaultReauthService,
  KnowledgeVaultService,
} from './services';

@Module({
  imports: [
    FilesModule,
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        AgencyUserSecuritySettingsEntity,
        // SEC-A1: author name (membership) and job title (Team) for authorship.
        AgencyWorkspaceUserEntity,
        TeamMember,
        AgencyKnowledgeArticle,
        AgencyKnowledgeArticleVersion,
        AgencyKnowledgeCategory,
        AgencyKnowledgeComment,
        AgencyKnowledgeQuickNote,
        AgencyKnowledgeReaction,
        AgencyKnowledgeVaultAccessLog,
        AgencyKnowledgeVaultItem,
        AgencyKnowledgeVaultPermission,
        HelpCategory,
        HelpTrail,
        HelpArticle,
        HelpTrailArticle,
      ],
      'agency',
    ),
  ],
  controllers: [
    KnowledgeArticlesController,
    KnowledgeAuthorshipController,
    KnowledgeCategoriesController,
    KnowledgeCommentsController,
    KnowledgeQuickNotesController,
    KnowledgeReactionsController,
    KnowledgeVaultController,
    HelpCenterController,
  ],
  providers: [
    KnowledgeArticlesService,
    KnowledgeAuthorshipService,
    KnowledgeCategoriesService,
    KnowledgeCommentsService,
    KnowledgeNotificationPublisher,
    KnowledgeQuickNotesService,
    KnowledgeReactionsService,
    KnowledgeVaultCryptoService,
    KnowledgeVaultReauthService,
    KnowledgeVaultService,
    HelpCenterService,
    HelpCenterSeedService,
  ],
  exports: [
    KnowledgeArticlesService,
    KnowledgeCategoriesService,
    KnowledgeCommentsService,
    KnowledgeNotificationPublisher,
    KnowledgeQuickNotesService,
    KnowledgeReactionsService,
    KnowledgeVaultService,
    HelpCenterService,
  ],
})
export class KnowledgeModule {}
