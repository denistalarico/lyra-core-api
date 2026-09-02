// src/modules/brand-kit/brand-kit.controller.ts
//
// Neutral Brand Kit surface (Lyra Social S1.4.9).
//
// Mounted at `/brand-kit`, the path the architecture specifies — not
// `/social/brand-kit`: the domain belongs to the Content & Creative Layer and
// is meant to serve any product that owns visual identity (D-8). Authorization
// stays product-bound regardless (see below).
//
// CONTEXT
// -------
// `PermissionsGuard` resolves `request.managedContext` from the caller's
// `x-lyra-product-key` / `x-lyra-operating-mode` / `x-lyra-client-id` headers
// via `OperationalContextResolver`, and — for a client-mode context — enforces
// `canAccessClientProduct()` for that same product before this controller
// runs. That is the D-15 fence: a client without an active Social entitlement
// never reaches a handler here, even if the client exists and has LeadFlow.
// The client id is therefore taken from the resolved context, never from a
// body, a query string or a header the handler reads itself.
//
// PERMISSIONS
// -----------
// `@RequireAnyPermission` exists only to make `PermissionsGuard` run at all
// (which is also what applies the context fence above). It is NOT the
// authorization decision: an OR across keys would let a viewer delete. The
// binding check is `assertProductPermission`, which resolves exactly one key
// from the request's own productKey and verb — the pattern established in
// S1.4.0 and corrected in S1.4.7/S1.4.8.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  PlatformPermissionService,
  RequireAnyPermission,
} from '../permissions';
import {
  BRAND_KIT_ANY_PERMISSIONS,
  resolveBrandKitPermissionKey,
  type BrandKitVerb,
} from './brand-kit-permission.helper';
import { BRAND_KIT_MAX_ASSET_BYTES } from './brand-kit-upload.rules';
import { CreateBrandKitAssetDto } from './dto/create-brand-kit-asset.dto';
import { UpdateBrandKitDto } from './dto/update-brand-kit.dto';
import { BrandKitService } from './services/brand-kit.service';

/**
 * Memory storage with a hard byte ceiling at the multer layer, so an
 * oversized body is cut off before it is ever fully buffered. The service
 * re-checks the size on the resulting buffer — multer's limit protects
 * memory, the service's check is the rule.
 */
const BRAND_KIT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: BRAND_KIT_MAX_ASSET_BYTES, files: 1 },
};

@Controller('brand-kit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BrandKitController {
  constructor(
    private readonly brandKitService: BrandKitService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  @Get()
  @RequireAnyPermission(...BRAND_KIT_ANY_PERMISSIONS)
  async getBrandKit(@RequestContextData() ctx: RequestContext) {
    await this.assertProductPermission(ctx, 'view');

    return this.brandKitService.getBrandKit(ctx, this.activeClientId(ctx));
  }

  @Patch()
  @RequireAnyPermission(...BRAND_KIT_ANY_PERMISSIONS)
  async updateBrandKit(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateBrandKitDto,
  ) {
    await this.assertProductPermission(ctx, 'update');

    return this.brandKitService.updateBrandKit(
      ctx,
      this.activeClientId(ctx),
      dto,
    );
  }

  @Get('assets')
  @RequireAnyPermission(...BRAND_KIT_ANY_PERMISSIONS)
  async listAssets(@RequestContextData() ctx: RequestContext) {
    await this.assertProductPermission(ctx, 'view');

    return this.brandKitService.listAssets(ctx, this.activeClientId(ctx));
  }

  @Post('assets')
  @RequireAnyPermission(...BRAND_KIT_ANY_PERMISSIONS)
  @UseInterceptors(FileInterceptor('file', BRAND_KIT_UPLOAD_OPTIONS))
  async uploadAsset(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateBrandKitAssetDto,
  ) {
    await this.assertProductPermission(ctx, 'update');

    return this.brandKitService.uploadAsset(ctx, this.activeClientId(ctx), {
      file,
      kind: dto.kind,
      variant: dto.variant ?? null,
      theme: dto.theme ?? null,
    });
  }

  /**
   * Streams the bytes of one asset, authenticated.
   *
   * Returns the binary directly — not base64 in JSON and not a redirect to a
   * public URL — because S1.4.10 consumes it as
   * `fetch(..., authHeaders) → Blob → URL.createObjectURL(blob)`. A plain
   * `<img src>` on this path would arrive without the Bearer header and get
   * 401, which is exactly why the object-URL contract exists (architecture
   * §3.B).
   *
   * `private, no-store` because this is customer content behind a permission:
   * a shared/public cache holding it would outlive the permission that
   * allowed the read. `nosniff` so a browser cannot be talked into
   * interpreting an image as something executable.
   */
  @Get('assets/:assetId/content')
  @RequireAnyPermission(...BRAND_KIT_ANY_PERMISSIONS)
  async getAssetContent(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId') assetId: string,
    @Res() response: Response,
  ) {
    await this.assertProductPermission(ctx, 'view');

    const { asset, file } = await this.brandKitService.getAssetContent(
      ctx,
      this.activeClientId(ctx),
      assetId,
    );

    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(asset.originalFilename)}"`,
    );

    file.body.pipe(response);
  }

  @Delete('assets/:assetId')
  @HttpCode(204)
  @RequireAnyPermission(...BRAND_KIT_ANY_PERMISSIONS)
  async deleteAsset(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId') assetId: string,
  ): Promise<void> {
    await this.assertProductPermission(ctx, 'delete');

    await this.brandKitService.deleteAsset(
      ctx,
      this.activeClientId(ctx),
      assetId,
    );
  }

  /**
   * The managed client the guard already authorized for the calling product;
   * `null` means the agency's own context.
   */
  private activeClientId(ctx: RequestContext): string | null {
    return ctx.managedContext?.clientId ?? null;
  }

  private async assertProductPermission(
    ctx: RequestContext,
    verb: BrandKitVerb,
  ): Promise<void> {
    const permissionKey = resolveBrandKitPermissionKey(
      ctx.managedContext?.productKey,
      verb,
    );

    await this.permissionService.assertCan(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId ?? '',
        role: ctx.role ?? '',
      },
      permissionKey,
    );
  }
}
