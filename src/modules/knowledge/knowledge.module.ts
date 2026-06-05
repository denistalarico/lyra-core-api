import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyUserSecuritySettingsEntity } from '../agency/entities/agency-auth.entities';
import {
  KnowledgeArticlesController,
  KnowledgeCategoriesController,
  KnowledgeCommentsController,
  KnowledgeReactionsController,
  KnowledgeVaultController,
} from './controllers';
import { KnowledgeVaultCryptoService } from './crypto/knowledge-vault-crypto.service';
import {
  AgencyKnowledgeArticle,
  AgencyKnowledgeArticleVersion,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeReaction,
  AgencyKnowledgeVaultAccessLog,
  AgencyKnowledgeVaultItem,
  AgencyKnowledgeVaultPermission,
} from './entities';
import {
  KnowledgeArticlesService,
  KnowledgeCategoriesService,
  KnowledgeCommentsService,
  KnowledgeReactionsService,
  KnowledgeVaultReauthService,
  KnowledgeVaultService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AgencyUserSecuritySettingsEntity,
        AgencyKnowledgeArticle,
        AgencyKnowledgeArticleVersion,
        AgencyKnowledgeCategory,
        AgencyKnowledgeComment,
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
    KnowledgeReactionsController,
    KnowledgeVaultController,
  ],
  providers: [
    KnowledgeArticlesService,
    KnowledgeCategoriesService,
    KnowledgeCommentsService,
    KnowledgeReactionsService,
    KnowledgeVaultCryptoService,
    KnowledgeVaultReauthService,
    KnowledgeVaultService,
  ],
  exports: [
    KnowledgeArticlesService,
    KnowledgeCategoriesService,
    KnowledgeCommentsService,
    KnowledgeReactionsService,
    KnowledgeVaultService,
  ],
})
export class KnowledgeModule {}
