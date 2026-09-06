import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import {
  CreateSocialPublicationDto,
  ListSocialPublicationsQueryDto,
} from './dto';
import {
  SocialPublicationService,
  type SocialPublicationScope,
} from './social-publication.service';
import { toSocialPublicationView } from './views/social-publication.view';

const VIEW_PERMISSION = 'social.publishing.publication.view.assigned';
const CREATE_PERMISSION = 'social.publishing.publication.create.manager';
const PUBLISH_NOW_PERMISSION =
  'social.publishing.publication.publish_now.manager';
const CANCEL_PERMISSION = 'social.publishing.publication.cancel.manager';

@Controller('social/publishing/publications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialPublicationController {
  constructor(private readonly publicationService: SocialPublicationService) {}

  @Get()
  @RequirePermission(VIEW_PERMISSION)
  async list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListSocialPublicationsQueryDto,
  ) {
    const { items, total } = await this.publicationService.list(
      this.requireScope(ctx),
      query,
    );

    return { items: items.map(toSocialPublicationView), total };
  }

  @Get(':publicationId')
  @RequirePermission(VIEW_PERMISSION)
  async get(
    @RequestContextData() ctx: RequestContext,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
  ) {
    const publication = await this.publicationService.get(
      this.requireScope(ctx),
      publicationId,
    );

    return toSocialPublicationView(publication);
  }

  @Post()
  @RequirePermission(CREATE_PERMISSION)
  async create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialPublicationDto,
  ) {
    const publication = await this.publicationService.create(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );

    return toSocialPublicationView(publication);
  }

  @Post(':publicationId/publish-now')
  @RequirePermission(PUBLISH_NOW_PERMISSION)
  async publishNow(
    @RequestContextData() ctx: RequestContext,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
  ) {
    const publication = await this.publicationService.publishNow(
      this.requireScope(ctx),
      publicationId,
    );

    return toSocialPublicationView(publication);
  }

  @Post(':publicationId/cancel')
  @RequirePermission(CANCEL_PERMISSION)
  async cancel(
    @RequestContextData() ctx: RequestContext,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
  ) {
    const publication = await this.publicationService.cancel(
      this.requireScope(ctx),
      ctx.userId ?? null,
      publicationId,
    );

    return toSocialPublicationView(publication);
  }

  @Post(':publicationId/retry')
  @RequirePermission(CREATE_PERMISSION)
  async retry(
    @RequestContextData() ctx: RequestContext,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
  ) {
    const publication = await this.publicationService.retry(
      this.requireScope(ctx),
      ctx.userId ?? null,
      publicationId,
    );

    return toSocialPublicationView(publication);
  }

  /**
   * Scope comes only from server-resolved request context.
   * The request body cannot select tenant/workspace/client ownership.
   */
  private requireScope(ctx: RequestContext): SocialPublicationScope {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const managedContext = ctx.managedContext;
    const agencyClientId =
      managedContext?.operatingMode === 'client'
        ? (managedContext.clientId ?? null)
        : null;

    if (managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Client context is required.');
    }

    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId,
    };
  }
}
