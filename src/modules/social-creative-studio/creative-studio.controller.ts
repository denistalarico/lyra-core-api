import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { MEDIA_ASSET_MAX_UPLOAD_BYTES } from '../../common/media-assets';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission, RequireProductEntitlement } from '../permissions';
import { CreativeAssetService } from './creative-asset.service';
import { CreativeFolderService } from './creative-folder.service';
import { CreateCreativeAssetDto, CreateCreativeFolderDto, ListCreativeAssetsQueryDto, UpdateCreativeAssetDto, UpdateCreativeFolderDto } from './dto/creative-studio.dto';
import { creativeStudioScope } from './creative-studio.scope';
import { FilesService } from '../../common/files/files.service';

const VIEW = 'social.creative.content.view.assigned';
const CREATE = 'social.creative.content.create_draft.assigned';
const UPDATE = 'social.creative.content.update.assigned';
const DELETE = 'social.creative.content.delete.owner_or_admin_explicit';
const UPLOAD_OPTIONS = { storage: memoryStorage(), limits: { fileSize: MEDIA_ASSET_MAX_UPLOAD_BYTES, files: 1 } };

@Controller('social/creative-studio')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeStudioController {
  constructor(private readonly assets: CreativeAssetService, private readonly folders: CreativeFolderService, private readonly files: FilesService) {}
  @Get('assets') @RequirePermission(VIEW) list(@RequestContextData() ctx: RequestContext, @Query() query: ListCreativeAssetsQueryDto) { return this.assets.list(creativeStudioScope(ctx), query); }
  @Post('assets') @RequirePermission(CREATE) @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS)) upload(@RequestContextData() ctx: RequestContext, @UploadedFile() file: Express.Multer.File, @Body() dto: CreateCreativeAssetDto) { return this.assets.upload(creativeStudioScope(ctx), ctx.userId ?? null, { file, ...dto }); }
  @Get('assets/:id/content') @RequirePermission(VIEW) async content(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) { await this.stream(ctx, id, false, response); }
  @Get('assets/:id/thumbnail') @RequirePermission(VIEW) async thumbnail(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) { await this.stream(ctx, id, true, response); }
  @Get('assets/:id/versions') @RequirePermission(VIEW) versions(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.assets.versionsFor(creativeStudioScope(ctx), id); }
  @Post('assets/:id/versions') @RequirePermission(UPDATE) @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS)) version(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) { return this.assets.createVersion(creativeStudioScope(ctx), ctx.userId ?? null, id, file); }
  @Post('assets/:id/archive') @RequirePermission(DELETE) archive(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.assets.archive(creativeStudioScope(ctx), id); }
  @Get('assets/:id') @RequirePermission(VIEW) detail(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) { return this.assets.detail(creativeStudioScope(ctx), id); }
  @Patch('assets/:id') @RequirePermission(UPDATE) update(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCreativeAssetDto) { return this.assets.update(creativeStudioScope(ctx), id, dto); }
  @Get('folders') @RequirePermission(VIEW) foldersList(@RequestContextData() ctx: RequestContext) { return this.folders.list(creativeStudioScope(ctx)); }
  @Post('folders') @RequirePermission(CREATE) createFolder(@RequestContextData() ctx: RequestContext, @Body() dto: CreateCreativeFolderDto) { return this.folders.create(creativeStudioScope(ctx), ctx.userId ?? null, dto); }
  @Patch('folders/:id') @RequirePermission(UPDATE) updateFolder(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCreativeFolderDto) { return this.folders.update(creativeStudioScope(ctx), id, dto.name); }
  @Delete('folders/:id') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermission(DELETE) async deleteFolder(@RequestContextData() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) { await this.folders.remove(creativeStudioScope(ctx), id); }
  private async stream(ctx: RequestContext, id: string, thumbnail: boolean, response: Response) { const media = await this.assets.content(creativeStudioScope(ctx), id, thumbnail); const file = await this.files.getPrivateAsset(media.storagePath); response.setHeader('Content-Type', media.mimeType); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); file.body.pipe(response); }
}
