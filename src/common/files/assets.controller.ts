import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AssetAccessService } from './asset-access.service';
import { FilesService } from './files.service';

@Controller('assets')
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly assetAccessService: AssetAccessService,
  ) {}

  /**
   * Serves a stored object.
   *
   * Public assets (logos, avatars, widget images) stream as before. Paths that
   * hold conversation content — Team Chat, project/task attachments, inbox media
   * — require a signed, expiring, viewer-bound grant issued by an endpoint that
   * already authorized the viewer. See `AssetAccessService` for why the grant
   * takes this form rather than a bearer stream (CCOM0.5 §23–§28).
   */
  @Get('*path')
  async getAsset(
    @Param('path') path: string | string[],
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const assetPath = Array.isArray(path) ? path.join('/') : path;
    const privateKind = this.assetAccessService.classifyPrivatePath(assetPath);

    if (privateKind) {
      const verdict = this.assetAccessService.verifyGrant(assetPath, query);

      if (!verdict.ok) {
        // Reason category only — never the grant, the signature or the key (§41).
        this.logger.warn(
          `Asset access denied: kind=${privateKind} reason=${verdict.reason}`,
        );
        throw new ForbiddenException('Acesso ao arquivo não autorizado.');
      }
    }

    const asset = await this.filesService.getAsset(assetPath);

    response.setHeader('Content-Type', asset.contentType);
    response.setHeader(
      'Cache-Control',
      // A private object must not be cached by shared caches: the grant is
      // per-viewer, so a cached copy would outlive the authorization.
      privateKind ? 'private, max-age=60, no-store' : asset.cacheControl,
    );
    asset.body.pipe(response);
  }
}
