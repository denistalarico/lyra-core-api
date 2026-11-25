import { ClientAreaExposed } from '../client-area/client-area.decorators';
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
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  DirectUploadTokenDto,
  MEDIA_ASSET_MAX_UPLOAD_BYTES,
  MediaAssetDirectUploadService,
  SignDirectUploadPartsDto,
  StartDirectUploadDto,
} from '../../common/media-assets';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeStudioBrandContextService } from './creative-brand-context.service';
import { CreativeFolderService } from './creative-folder.service';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import {
  CompleteCreativeDirectUploadDto,
  CompleteCreativeVersionDirectUploadDto,
  CreateCreativeAssetDto,
  CopyCreativeAssetDto,
  CreativeFolderDestinationDto,
  CreateCreativeFolderDto,
  CreateCreativeVersionDto,
  ListCreativeAssetsQueryDto,
  UpdateCreativeAssetDto,
  UpdateCreativeFolderDto,
  UpdateCreativeRetentionDto,
} from './dto/creative-studio.dto';
import { CreativeStudioSettingsService } from './creative-studio-settings.service';
import { creativeStudioScope } from './creative-studio.scope';
import { FilesService } from '../../common/files/files.service';

const VIEW = 'social.creative.content.view.assigned';
const CREATE = 'social.creative.content.create_draft.assigned';
const UPDATE = 'social.creative.content.update.assigned';
const DELETE = 'social.creative.content.delete.owner_or_admin_explicit';
const UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MEDIA_ASSET_MAX_UPLOAD_BYTES, files: 1 },
};

@Controller('social/creative-studio')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeStudioController {
  constructor(
    private readonly assets: CreativeAssetService,
    private readonly folders: CreativeFolderService,
    private readonly files: FilesService,
    private readonly brandContext: CreativeStudioBrandContextService,
    private readonly versionApprovals: CreativeVersionApprovalService,
    private readonly settings: CreativeStudioSettingsService,
    private readonly directUploads: MediaAssetDirectUploadService,
  ) {}
  /**
   * Direct upload of a heavy video (browser → R2 in parts, 2026-11-18).
   * `start` is permitted by CREATE or UPDATE through the two routes below;
   * the parts/abort calls are bound to the token (scope + actor) it issued.
   */
  @Post('direct-uploads')
  @RequirePermission(CREATE)
  startDirectUpload(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: StartDirectUploadDto,
  ) {
    return this.startStudioDirectUpload(ctx, dto);
  }
  @Post('assets/:id/versions/direct-uploads')
  @RequirePermission(UPDATE)
  startVersionDirectUpload(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() dto: StartDirectUploadDto,
  ) {
    return this.startStudioDirectUpload(ctx, dto);
  }
  @Post('direct-uploads/parts')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(VIEW)
  signDirectUploadParts(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SignDirectUploadPartsDto,
  ) {
    return this.directUploads.signParts(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      dto.token,
      dto.partNumbers,
    );
  }
  @Post('direct-uploads/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(VIEW)
  async abortDirectUpload(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: DirectUploadTokenDto,
  ) {
    await this.directUploads.abort(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      dto.token,
    );
  }
  @Post('direct-uploads/complete')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(CREATE)
  async completeDirectUpload(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CompleteCreativeDirectUploadDto,
  ) {
    const scope = creativeStudioScope(ctx);
    const actor = ctx.userId ?? null;
    const stored = await this.directUploads.complete(
      scope,
      actor,
      dto.token,
      dto.parts,
      'creative_studio',
    );
    return this.assets.upload(scope, actor, {
      file: { stored },
      name: dto.name,
      folderId: dto.folderId,
      contentItemId: dto.contentItemId,
    });
  }
  @Post('assets/:id/versions/direct-uploads/complete')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(UPDATE)
  async completeVersionDirectUpload(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteCreativeVersionDirectUploadDto,
  ) {
    const scope = creativeStudioScope(ctx);
    const actor = ctx.userId ?? null;
    const stored = await this.directUploads.complete(
      scope,
      actor,
      dto.token,
      dto.parts,
      'creative_studio',
    );
    try {
      if (dto.revisesVersionId)
        return await this.versionApprovals.startRevision(
          scope,
          actor,
          id,
          dto.revisesVersionId,
          { stored },
        );
      return await this.assets.createVersion(scope, actor, id, { stored });
    } catch (error) {
      // Approvals may refuse before the Studio sees the video: never orphan it.
      await this.assets.discardDirectUpload(scope, stored.id);
      throw error;
    }
  }
  private startStudioDirectUpload(
    ctx: RequestContext,
    dto: StartDirectUploadDto,
  ) {
    return this.directUploads.start(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      {
        filename: dto.filename,
        mimeType: dto.mimeType,
        byteSize: dto.byteSize,
        source: 'creative_studio',
      },
    );
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('brand-context')
  @RequirePermission(VIEW)
  brandContextForStudio(@RequestContextData() ctx: RequestContext) {
    return this.brandContext.load(creativeStudioScope(ctx));
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('storage')
  @RequirePermission(VIEW)
  storage(@RequestContextData() ctx: RequestContext) {
    return this.assets.storage(creativeStudioScope(ctx));
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('assets')
  @RequirePermission(VIEW)
  list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListCreativeAssetsQueryDto,
  ) {
    return this.assets.list(creativeStudioScope(ctx), query);
  }
  @ClientAreaExposed('social_creative_studio')
  @Post('assets')
  @RequirePermission(CREATE)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  upload(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateCreativeAssetDto,
  ) {
    return this.assets.upload(creativeStudioScope(ctx), ctx.userId ?? null, {
      file,
      ...dto,
    });
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('assets/:id/content')
  @RequirePermission(VIEW)
  async content(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versionId') versionId: string | undefined,
    @Res() response: Response,
  ) {
    await this.stream(ctx, id, false, versionId, response);
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('assets/:id/thumbnail')
  @RequirePermission(VIEW)
  async thumbnail(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versionId') versionId: string | undefined,
    @Res() response: Response,
  ) {
    await this.stream(ctx, id, true, versionId, response);
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('assets/:id/versions')
  @RequirePermission(VIEW)
  versions(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.versionsFor(creativeStudioScope(ctx), id);
  }
  @ClientAreaExposed('social_creative_studio')
  @Post('assets/:id/versions')
  @RequirePermission(UPDATE)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  version(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateCreativeVersionDto,
  ) {
    if (dto.revisesVersionId)
      return this.versionApprovals.startRevision(
        creativeStudioScope(ctx),
        ctx.userId ?? null,
        id,
        dto.revisesVersionId,
        file,
      );
    return this.assets.createVersion(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      id,
      file,
    );
  }
  // F2 (2026-11-24): archive/delete/restore reach the Client Area for the
  // company's Owner only (dangerous key, granted by the projection to
  // `client_owner`); the Social adapter proves the asset's company.
  @ClientAreaExposed('social_creative_studio')
  @Post('assets/:id/archive')
  @RequirePermission(DELETE)
  archive(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.archive(creativeStudioScope(ctx), id);
  }
  @ClientAreaExposed('social_creative_studio')
  @Delete('assets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(DELETE)
  async removeAsset(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('permanent') permanent?: string,
  ) {
    await this.assets.remove(
      creativeStudioScope(ctx),
      id,
      permanent === 'true',
    );
  }
  @ClientAreaExposed('social_creative_studio')
  @Post('assets/:id/restore')
  @RequirePermission(DELETE)
  restore(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.restore(creativeStudioScope(ctx), id);
  }
  // F3 (2026-11-24): Settings › Armazenamento in the Client Area. The row is
  // keyed by (tenant, workspace, agencyClient, companyContext), so the Bridge's
  // forced company writes only that company's retention. PUT carries the
  // dangerous DELETE key, projected to the company's Owner only.
  @ClientAreaExposed('social_creative_studio')
  @Get('retention')
  @RequirePermission(VIEW)
  retention(@RequestContextData() ctx: RequestContext) {
    return this.settings.retention(creativeStudioScope(ctx));
  }
  @ClientAreaExposed('social_creative_studio')
  @Put('retention')
  @RequirePermission(DELETE)
  updateRetention(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateCreativeRetentionDto,
  ) {
    return this.settings.updateRetention(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      dto.plannerUploadRetentionDays,
    );
  }
  @Post('trash/empty')
  @RequirePermission(DELETE)
  emptyTrash(@RequestContextData() ctx: RequestContext) {
    return this.assets.emptyTrash(creativeStudioScope(ctx));
  }
  @ClientAreaExposed('social_creative_studio')
  @Post('assets/:id/copy')
  @RequirePermission(CREATE)
  copy(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopyCreativeAssetDto,
  ) {
    return this.assets.copy(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      id,
      dto.folderId,
    );
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('assets/:id')
  @RequirePermission(VIEW)
  detail(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.detail(creativeStudioScope(ctx), id);
  }
  @ClientAreaExposed('social_creative_studio')
  @Patch('assets/:id')
  @RequirePermission(UPDATE)
  update(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreativeAssetDto,
  ) {
    return this.assets.update(creativeStudioScope(ctx), id, dto);
  }
  @ClientAreaExposed('social_creative_studio')
  @Get('folders')
  @RequirePermission(VIEW)
  foldersList(@RequestContextData() ctx: RequestContext) {
    return this.folders.list(creativeStudioScope(ctx));
  }
  @ClientAreaExposed('social_creative_studio')
  @Post('folders')
  @RequirePermission(CREATE)
  createFolder(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateCreativeFolderDto,
  ) {
    return this.folders.create(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }
  @ClientAreaExposed('social_creative_studio')
  @Patch('folders/:id')
  @RequirePermission(UPDATE)
  updateFolder(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreativeFolderDto,
  ) {
    return this.folders.update(creativeStudioScope(ctx), id, dto.name);
  }
  @Delete('folders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(DELETE)
  async deleteFolder(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('recursive') recursive?: string,
    @Query('permanent') permanent?: string,
  ) {
    if (recursive === 'true')
      await this.folders.removeTree(
        creativeStudioScope(ctx),
        id,
        permanent === 'true',
      );
    else await this.folders.remove(creativeStudioScope(ctx), id);
  }
  @Post('folders/:id/move')
  @RequirePermission(UPDATE)
  moveFolder(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreativeFolderDestinationDto,
  ) {
    return this.folders.move(creativeStudioScope(ctx), id, dto.parentId);
  }
  @Post('folders/:id/copy')
  @RequirePermission(CREATE)
  copyFolder(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreativeFolderDestinationDto,
  ) {
    return this.folders.copy(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      id,
      dto.parentId,
    );
  }
  @Post('folders/:id/archive')
  @RequirePermission(DELETE)
  archiveFolder(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.folders.archive(creativeStudioScope(ctx), id);
  }
  private async stream(
    ctx: RequestContext,
    id: string,
    thumbnail: boolean,
    versionId: string | undefined,
    response: Response,
  ) {
    const media = await this.assets.content(
      creativeStudioScope(ctx),
      id,
      thumbnail,
      versionId,
    );
    const file = await this.files.getPrivateAsset(media.storagePath);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }
}
