import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { AgencyUserSecuritySettingsEntity } from '../agency/entities/agency-auth.entities';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import {
  KnowledgeArticlesController,
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
  KnowledgeArticlesService,
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
        AgencyKnowledgeArticle,
        AgencyKnowledgeArticleVersion,
        AgencyKnowledgeCategory,
        AgencyKnowledgeComment,
        AgencyKnowledgeQuickNote,
        AgencyKnowledgeReaction,
        AgencyKnowledgeVaultAccessLog,
        AgencyKnowledgeVaultItem,
        AgencyKnowledgeVaultPermission,
      ],
      'agency',
    ),
  ],
  controllers: [
    KnowledgeArticlesController,
    KnowledgeCategoriesController,
    KnowledgeCommentsController,
    KnowledgeQuickNotesController,
    KnowledgeReactionsController,
    KnowledgeVaultController,
  ],
  providers: [
    KnowledgeArticlesService,
    KnowledgeCategoriesService,
    KnowledgeCommentsService,
    KnowledgeNotificationPublisher,
    KnowledgeQuickNotesService,
    KnowledgeReactionsService,
    KnowledgeVaultCryptoService,
    KnowledgeVaultReauthService,
    KnowledgeVaultService,
  ],
  exports: [
    KnowledgeArticlesService,
    KnowledgeCategoriesService,
    KnowledgeCommentsService,
    KnowledgeNotificationPublisher,
    KnowledgeQuickNotesService,
    KnowledgeReactionsService,
    KnowledgeVaultService,
  ],
})
export class KnowledgeModule {}
