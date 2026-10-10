import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { KnowledgeAuthorshipService } from '../services';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

/**
 * Preview of how the authenticated user can sign Knowledge content (SEC-A1).
 * The labels come from the same resolver that writes the snapshot, so the
 * preview is exactly what will be published.
 */
@Controller('agency/knowledge/authorship')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeAuthorshipController {
  constructor(private readonly authorshipService: KnowledgeAuthorshipService) {}

  @Get()
  @RequirePermission('agency.knowledge.articles.view.published')
  async preview(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.authorshipService.describe(
      await this.authorshipService.getIdentity(context),
    );
  }
}
