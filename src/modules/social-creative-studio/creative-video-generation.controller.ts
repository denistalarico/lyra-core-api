import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { creativeStudioScope } from './creative-studio.scope';
import { CreativeVideoAvatarCatalogService } from './creative-video-avatar-catalog.service';
import { CreativeVideoCallbackService } from './creative-video-callback.service';
import { CreativeVideoGenerationService } from './creative-video-generation.service';
import {
  PromoteGeneratedOutputAsVersionDto,
  PromoteGeneratedOutputDto,
} from './dto/creative-image-generation.dto';
import { GenerateCreativeVideoDto } from './dto/creative-video-generation.dto';

const VIEW = 'social.creative.content.view.assigned';
const CREATE = 'social.creative.content.create_draft.assigned';
const UPDATE = 'social.creative.content.update.assigned';

/**
 * CS4-B — Reel generation. One semantic API for every provider; same guards,
 * entitlement and permissions as image generation. `POST` answers 202 and
 * requires `Idempotency-Key`; the client polls `GET :generationId`.
 */
@Controller('social/creative-studio/video-generations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeVideoGenerationController {
  constructor(private readonly generation: CreativeVideoGenerationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(CREATE)
  generate(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: GenerateCreativeVideoDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.generation.enqueue(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      dto,
      idempotencyKey,
    );
  }

  @Get(':generationId') @RequirePermission(VIEW) get(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
  ) {
    return this.generation.get(creativeStudioScope(ctx), generationId);
  }

  @Get(':generationId/content')
  @RequirePermission(VIEW)
  async content(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Res() response: Response,
  ) {
    const { asset, file } = await this.generation.readContent(
      creativeStudioScope(ctx),
      generationId,
    );
    stream(response, asset.mimeType, file.body);
  }

  @Get(':generationId/poster')
  @RequirePermission(VIEW)
  async poster(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Res() response: Response,
  ) {
    const { asset, file } = await this.generation.readPoster(
      creativeStudioScope(ctx),
      generationId,
    );
    stream(response, asset.mimeType, file.body);
  }

  @Post(':generationId/promote') @RequirePermission(CREATE) promote(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Body() dto: PromoteGeneratedOutputDto,
  ) {
    return this.generation.promoteToNewAsset(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      generationId,
      dto,
    );
  }

  @Post(':generationId/promote-as-version')
  @RequirePermission(UPDATE)
  promoteAsVersion(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Body() dto: PromoteGeneratedOutputAsVersionDto,
  ) {
    return this.generation.promoteToVersion(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      generationId,
      dto,
    );
  }
}

/** CS4-B — avatars UGC may use (Lyra ids; previews proxied, never provider URLs). */
@Controller('social/creative-studio/video-avatars')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeVideoAvatarController {
  constructor(private readonly catalog: CreativeVideoAvatarCatalogService) {}

  @Get() @RequirePermission(VIEW) list() {
    return this.catalog.list();
  }

  @Get(':avatarId/preview')
  @RequirePermission(VIEW)
  async preview(
    @Param('avatarId', ParseUUIDPipe) avatarId: string,
    @Res() response: Response,
  ) {
    const { body, mimeType } = await this.catalog.preview(avatarId);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(body);
  }
}

/**
 * CS4-B — provider callbacks. Public by necessity (providers carry no Lyra
 * JWT); the adapter verifies the provider's signature and the callback is
 * only a hint (see `CreativeVideoCallbackService`). Always 204, whatever
 * happened: the answer never reveals whether a job id exists.
 */
@Controller('social/creative-studio/video-provider-callbacks')
export class CreativeVideoCallbackController {
  constructor(private readonly callbacks: CreativeVideoCallbackService) {}

  @Post(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<void> {
    const [path, query = ''] = request.originalUrl.split('?');
    await this.callbacks.handle(provider, {
      method: request.method,
      path,
      query,
      headers: request.headers,
      rawBody: request.rawBody,
    });
  }
}

function stream(
  response: Response,
  mimeType: string,
  body: NodeJS.ReadableStream,
) {
  response.setHeader('Content-Type', mimeType);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  body.pipe(response);
}
