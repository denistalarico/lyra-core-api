import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FilesService } from './files.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly filesService: FilesService) {}

  @Get('*path')
  async getAsset(
    @Param('path') path: string | string[],
    @Res() response: Response,
  ) {
    const assetPath = Array.isArray(path) ? path.join('/') : path;
    const asset = await this.filesService.getAsset(assetPath);

    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Cache-Control', asset.cacheControl);
    asset.body.pipe(response);
  }
}
