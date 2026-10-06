import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  LinkSocialContentReferenceDto,
  ReorderSocialContentReferencesDto,
  UpdateSocialContentReferenceDto,
} from './dto';
import { SocialContentReferenceService } from './services/social-content-reference.service';

/** Same keys as the content item itself: references are part of editing it. */
const VIEW = 'social.planner.calendar.view.client';
const UPDATE = 'social.planner.calendar.update.manager';

/**
 * Planner Visual References of one content item. Same prefix, guards and
 * entitlement as `SocialPlannerController`; scope (Company Context included)
 * comes from the request context only.
 *
 * New image: `POST /social/publishing/media` with `source=planner_reference`,
 * then `POST …/references` with the returned `mediaAssetId`.
 */
@Controller('social/planner')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialContentReferenceController {
  constructor(private readonly references: SocialContentReferenceService) {}

  @Get('content/:contentId/references')
  @RequirePermission(VIEW)
  list(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.references.list(resolveCompanyAwareScope(ctx), contentId);
  }

  @Post('content/:contentId/references')
  @RequirePermission(UPDATE)
  link(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: LinkSocialContentReferenceDto,
  ) {
    return this.references.link(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
      contentId,
      dto,
    );
  }

  @Put('content/:contentId/references/order')
  @RequirePermission(UPDATE)
  reorder(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: ReorderSocialContentReferencesDto,
  ) {
    return this.references.reorder(
      resolveCompanyAwareScope(ctx),
      contentId,
      dto.referenceIds,
    );
  }

  @Patch('content/:contentId/references/:referenceId')
  @RequirePermission(UPDATE)
  update(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('referenceId', ParseUUIDPipe) referenceId: string,
    @Body() dto: UpdateSocialContentReferenceDto,
  ) {
    return this.references.update(
      resolveCompanyAwareScope(ctx),
      contentId,
      referenceId,
      dto,
    );
  }

  /** Removes the link only; the image stays in the media library. */
  @Delete('content/:contentId/references/:referenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(UPDATE)
  remove(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('referenceId', ParseUUIDPipe) referenceId: string,
  ) {
    return this.references.remove(
      resolveCompanyAwareScope(ctx),
      contentId,
      referenceId,
    );
  }
}
