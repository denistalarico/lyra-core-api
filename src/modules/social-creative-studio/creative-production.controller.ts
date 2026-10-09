import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MEDIA_ASSET_MAX_UPLOAD_BYTES } from '../../common/media-assets';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CREATIVE_PRODUCTION_PERMISSIONS as P } from './creative-production.permissions';
import { CreativeProductionService } from './creative-production.service';
import { creativeStudioScope } from './creative-studio.scope';
import {
  CreateProductionTaskDto,
  HandoffProductionDestinationDto,
  LinkProductionTaskDto,
  ProductionWorkCandidatesQueryDto,
  SelectCreativeVersionDto,
  UploadProductionCreativeDto,
} from './dto/creative-production.dto';

/** Same limits as the Studio upload (CS1): one file, media-asset ceiling. */
const UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MEDIA_ASSET_MAX_UPLOAD_BYTES, files: 1 },
};

/**
 * CS5-B — creative production of one Planner content item.
 *
 * Under the Studio prefix because the Studio owns the selection; every command
 * orchestrates the owner of its side effect (Approvals, Agency Tasks,
 * destination creatives, Planner). Scope comes only from the request context.
 * Task commands also require the Agency keys, checked in the service because
 * a route carries a single `@RequirePermission`.
 */
@Controller('social/creative-studio/production')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeProductionController {
  constructor(private readonly production: CreativeProductionService) {}

  @Get(':contentItemId')
  @RequirePermission(P.view)
  view(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
  ) {
    return this.production.view(ctx, creativeStudioScope(ctx), contentItemId);
  }

  /** `PUT`: one selection per item; replaying the same version is a no-op. */
  @Put(':contentItemId/selected-version')
  @RequirePermission(P.update)
  select(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @Body() dto: SelectCreativeVersionDto,
  ) {
    return this.production.selectVersion(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
      dto.versionId,
    );
  }

  /**
   * CS5 Closeout — upload a new file and select it explicitly (Production's
   * "Enviar novo arquivo" and the Planner's "replace the creative"). The
   * Studio's upload key is checked in the service, on top of `update`.
   */
  @Post(':contentItemId/creative')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(P.update)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  uploadCreative(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadProductionCreativeDto,
  ) {
    return this.production.uploadAndSelect(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
      file,
      dto,
    );
  }

  @Delete(':contentItemId/selected-version')
  @RequirePermission(P.update)
  clearSelection(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
  ) {
    return this.production.clearSelection(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
    );
  }

  /** The selected version is resolved server-side; idempotent per version. */
  @Post(':contentItemId/send-for-approval')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(P.submitReview)
  sendForApproval(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
  ) {
    return this.production.sendSelectedForApproval(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
    );
  }

  /** Tasks the link command accepts for this item (same predicate). */
  @Get(':contentItemId/task-candidates')
  @RequirePermission(P.update)
  taskCandidates(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @Query() query: ProductionWorkCandidatesQueryDto,
  ) {
    return this.production.taskCandidates(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
      query,
    );
  }

  /** Projects the task creation accepts for this item (same predicate). */
  @Get(':contentItemId/project-candidates')
  @RequirePermission(P.update)
  projectCandidates(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @Query() query: ProductionWorkCandidatesQueryDto,
  ) {
    return this.production.projectCandidates(
      creativeStudioScope(ctx),
      contentItemId,
      query,
    );
  }

  @Put(':contentItemId/task-link')
  @RequirePermission(P.update)
  linkTask(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @Body() dto: LinkProductionTaskDto,
  ) {
    return this.production.linkTask(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
      dto,
    );
  }

  @Delete(':contentItemId/task-link')
  @RequirePermission(P.update)
  unlinkTask(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
  ) {
    return this.production.unlinkTask(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
    );
  }

  /** Opt-in; one task per item (a retry returns the linked task). */
  @Post(':contentItemId/task')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(P.update)
  createTask(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @Body() dto: CreateProductionTaskDto,
  ) {
    return this.production.createTask(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
      dto,
    );
  }

  @Post(':contentItemId/destinations/:destinationId/handoff')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(P.plannerUpdate)
  handoff(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
    @Param('destinationId', ParseUUIDPipe) destinationId: string,
    @Body() dto: HandoffProductionDestinationDto,
  ) {
    return this.production.handoffToDestination(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
      destinationId,
      dto,
    );
  }

  @Post(':contentItemId/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(P.update)
  reconcile(
    @RequestContextData() ctx: RequestContext,
    @Param('contentItemId', ParseUUIDPipe) contentItemId: string,
  ) {
    return this.production.reconcile(
      ctx,
      creativeStudioScope(ctx),
      contentItemId,
    );
  }
}
