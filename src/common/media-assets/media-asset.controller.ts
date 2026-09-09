// src/common/media-assets/media-asset.controller.ts
//
// The upload and listing surface `MediaAsset` never had (Social Planner E3,
// blocker B1). Without it `mediaAssetId` was required to publish an image or
// video and no caller could obtain one.
//
// MOUNT PATH
// ----------
// `/social/publishing/media`, not a neutral `/media-assets`. The entity is a
// shared boundary, but an ENDPOINT needs one authorization story, and this one
// is Social's: the guards below require the `social` entitlement and a
// `social.publishing.media.*` permission. When a second product needs uploads
// it gets its own controller with its own permission over the same service —
// the alternative, one neutral endpoint with an OR across products' keys,
// would let a LeadFlow-only operator write into a Social scope.
//
// SCOPE
// -----
// From `@RequestContextData()` only. `PermissionsGuard` resolves
// `managedContext` from the caller's `x-lyra-*` headers and authorizes the
// client-product pair before any handler here runs. A body or query parameter
// naming a client is never read: that is how media gets written into another
// client's scope.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequestContextData } from '../context/request-context.decorator';
import type { RequestContext } from '../context/request-context.interface';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../modules/permissions';
import { ListMediaAssetsQueryDto } from './dto/list-media-assets-query.dto';
import { UploadMediaAssetDto } from './dto/upload-media-asset.dto';
import type { MediaAssetScope } from './media-asset-resolver.service';
import { MEDIA_ASSET_MAX_UPLOAD_BYTES } from './media-asset-upload.rules';
import { MediaAssetUploadService } from './media-asset-upload.service';
import { toMediaAssetView } from './views/media-asset.view';

const VIEW_PERMISSION = 'social.publishing.media.view.assigned';
const UPLOAD_PERMISSION = 'social.publishing.media.upload.manager';

/**
 * Memory storage with a hard byte ceiling at the multer layer, so an oversized
 * body is cut off before it is fully buffered. The service re-checks the size
 * on the resulting buffer: multer's limit protects memory, the service's check
 * is the rule.
 */
const MEDIA_ASSET_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MEDIA_ASSET_MAX_UPLOAD_BYTES, files: 1 },
};

@Controller('social/publishing/media')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class MediaAssetController {
  constructor(private readonly uploadService: MediaAssetUploadService) {}

  @Get()
  @RequirePermission(VIEW_PERMISSION)
  async list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListMediaAssetsQueryDto,
  ) {
    const { items, total } = await this.uploadService.list(
      this.requireScope(ctx),
      { limit: query.limit },
    );

    return { items: items.map(toMediaAssetView), total };
  }

  @Post()
  @RequirePermission(UPLOAD_PERMISSION)
  @UseInterceptors(FileInterceptor('file', MEDIA_ASSET_UPLOAD_OPTIONS))
  async upload(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
    // `source` is provenance only ("planner_upload", "creative_studio", …).
    // It labels where an asset came from and never selects scope, storage or
    // authorization, so accepting it from the body is safe where a client id
    // would not be.
    @Body() dto: UploadMediaAssetDto,
  ) {
    const asset = await this.uploadService.upload(
      this.requireScope(ctx),
      ctx.userId ?? null,
      { file, source: dto.source ?? 'planner_upload' },
    );

    return toMediaAssetView(asset);
  }

  /**
   * Streams one asset's bytes, authenticated.
   *
   * Binary directly — not a public URL and not a redirect — because that is
   * the only way to show private client media in a UI without making it
   * public (T23). The browser cannot send an auth header on a plain
   * `<img src>`, so the frontend fetches this with its session headers and
   * renders the result through `URL.createObjectURL`.
   *
   * `private, no-store` because this is customer content behind a permission:
   * a shared cache holding it would outlive the permission that allowed the
   * read. `nosniff` so a browser cannot be talked into interpreting media as
   * something executable.
   */
  @Get(':mediaAssetId/content')
  @RequirePermission(VIEW_PERMISSION)
  async getContent(
    @RequestContextData() ctx: RequestContext,
    @Param('mediaAssetId', ParseUUIDPipe) mediaAssetId: string,
    @Res() response: Response,
  ) {
    const { asset, file } = await this.uploadService.getContent(
      this.requireScope(ctx),
      mediaAssetId,
    );

    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(asset.originalFilename ?? 'arquivo')}"`,
    );

    file.body.pipe(response);
  }

  /**
   * Scope comes only from server-resolved request context — the same shape
   * `SocialPublicationController.requireScope` uses, so a media asset and the
   * publication that references it can never resolve to different scopes.
   */
  private requireScope(ctx: RequestContext): MediaAssetScope {
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
