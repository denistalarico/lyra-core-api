import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  HttpCode,
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
  RescheduleSocialPublicationDto,
} from './dto';
import { SocialPublisherRegistry } from '../providers';
import {
  SocialPublicationService,
  type SocialPublicationScope,
} from './social-publication.service';
import { toSocialPublicationView } from './views/social-publication.view';
import { toSocialPublisherCapabilityView } from './views/social-publisher-capability.view';
import { toSocialPublishTargetView } from './views/social-publish-target.view';

const VIEW_PERMISSION = 'social.publishing.publication.view.assigned';
const CREATE_PERMISSION = 'social.publishing.publication.create.manager';
const PUBLISH_NOW_PERMISSION =
  'social.publishing.publication.publish_now.manager';
const CANCEL_PERMISSION = 'social.publishing.publication.cancel.manager';
const DELETE_FAILED_PERMISSION =
  'social.publishing.publication.delete_external.admin_or_explicit';

@Controller('social/publishing/publications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialPublicationController {
  constructor(
    private readonly publicationService: SocialPublicationService,
    private readonly publisherRegistry: SocialPublisherRegistry,
  ) {}

  /**
   * The declared capability matrix, so the composer offers exactly what the
   * validator accepts (E3).
   *
   * Read from the registry, never from a provider's static constants: the
   * registry is what schedule-time validation resolves through, so anything
   * absent here would also be refused there. That is why an unregistered
   * adapter correctly disappears from the UI instead of being offered.
   *
   * `VIEW_PERMISSION`, not the create one: this is a static declaration about
   * formats, carrying no workspace data and no scope-bearing value, and the
   * composer must be able to render a disabled, explained state to someone who
   * may read publications but not schedule them.
   *
   * Declared BEFORE `@Get(':publicationId')` — Nest matches routes in
   * declaration order, so the parameterized route would otherwise swallow
   * `/capabilities` and answer with a uuid parse error.
   */
  @Get('capabilities')
  @RequirePermission(VIEW_PERMISSION)
  capabilities() {
    const items = this.publisherRegistry.registeredPairs.map(
      ({ provider, assetType }) =>
        toSocialPublisherCapabilityView(
          this.publisherRegistry.resolve(provider, assetType).capabilities(
            assetType,
          ),
        ),
    );

    return { items, total: items.length };
  }

  /**
   * The connected accounts this scope may publish to (E3).
   *
   * Deliberately NOT served by reusing `GET /social/organic/connections`: that
   * endpoint requires `social.settings.integrations.manage.admin`, and the
   * composer must work for an operator who schedules posts without
   * administering integrations. Widening that permission so the composer could
   * call it would hand integration management to every publisher — the
   * mistake the Social Analytics screen already avoided once by taking its own
   * endpoint instead.
   *
   * Declared before `@Get(':publicationId')` for the same route-ordering
   * reason as `capabilities`.
   */
  @Get('targets')
  @RequirePermission(VIEW_PERMISSION)
  async targets(@RequestContextData() ctx: RequestContext) {
    const assets = await this.publicationService.listPublishTargets(
      this.requireScope(ctx),
    );

    return {
      items: assets.map(toSocialPublishTargetView),
      total: assets.length,
    };
  }

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

  /**
   * Moves a scheduled publication (E6).
   *
   * `PATCH` on a sub-resource rather than a `POST` action, because this is a
   * partial update of the row's own timing, not a command with side effects
   * elsewhere — unlike `publish-now`, `cancel` and `retry`, which each change
   * what the publication IS.
   *
   * It answers to the publish-now permission, not the create one. Both move a
   * publication's due time on a row that already exists; whoever may pull a
   * post forward to right now is exactly whoever may push it to Thursday.
   * Requiring the create permission would let someone schedule new posts but
   * not fix the time of the one they just scheduled.
   */
  @Patch(':publicationId/schedule')
  @RequirePermission(PUBLISH_NOW_PERMISSION)
  async reschedule(
    @RequestContextData() ctx: RequestContext,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
    @Body() dto: RescheduleSocialPublicationDto,
  ) {
    const publication = await this.publicationService.reschedule(
      this.requireScope(ctx),
      publicationId,
      new Date(dto.scheduledAt),
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
   * A failed, never-published local attempt has no provider evidence to
   * preserve. This route is intentionally narrower than an external deletion:
   * the service rejects every other state and any row with an external id.
   */
  @Delete(':publicationId')
  @HttpCode(204)
  @RequirePermission(DELETE_FAILED_PERMISSION)
  async deleteFailed(
    @RequestContextData() ctx: RequestContext,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
  ): Promise<void> {
    await this.publicationService.deleteFailed(
      this.requireScope(ctx),
      publicationId,
    );
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
