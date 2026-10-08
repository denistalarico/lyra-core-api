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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreativeImageGenerationService } from './creative-image-generation.service';
import { creativeStudioScope } from './creative-studio.scope';
import {
  GenerateCreativeImageDto,
  PromoteGeneratedOutputAsVersionDto,
  PromoteGeneratedOutputDto,
  RegenerateCreativeImageDto,
  VaryCreativeImageDto,
} from './dto/creative-image-generation.dto';

const VIEW = 'social.creative.content.view.assigned';
const CREATE = 'social.creative.content.create_draft.assigned';
const UPDATE = 'social.creative.content.update.assigned';

/**
 * CS3.1/CS3.2 — asynchronous image generation and explicit promotion. Same
 * prefix, guards and entitlement as the main Studio controller; promotion
 * keeps the permission of the operation it reuses (new asset = create, new
 * version = update).
 *
 * `POST images` only records the generation and answers 202; the client
 * polls `GET :generationId`. It requires an `Idempotency-Key` header (CS3.2.1):
 * a repeat with the same key and request answers 202 with the same
 * generation, a different request under the same key is a 409. `outputId` is the generation output's own id,
 * never the media asset's.
 */
@Controller('social/creative-studio/generations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeImageGenerationController {
  constructor(private readonly generation: CreativeImageGenerationService) {}

  @Post('images')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(CREATE)
  generateImages(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: GenerateCreativeImageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.generation.enqueue(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      dto,
      idempotencyKey,
    );
  }

  /**
   * CS3.6.2 — a new generation with this one's intent (202, same contract
   * and `Idempotency-Key` rules as `POST images`). The origin is untouched.
   */
  @Post(':generationId/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(CREATE)
  regenerate(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Body() dto: RegenerateCreativeImageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.generation.regenerate(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      generationId,
      dto,
      idempotencyKey,
    );
  }

  /** CS3.6.2 — a new generation varying this output (410 once it expired). */
  @Post('outputs/:outputId/vary')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(CREATE)
  varyOutput(
    @RequestContextData() ctx: RequestContext,
    @Param('outputId', ParseUUIDPipe) outputId: string,
    @Body() dto: VaryCreativeImageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.generation.varyOutput(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      outputId,
      dto,
      idempotencyKey,
    );
  }

  @Get(':generationId') @RequirePermission(VIEW) getGeneration(
    @RequestContextData() ctx: RequestContext,
    @Param('generationId', ParseUUIDPipe) generationId: string,
  ) {
    return this.generation.get(creativeStudioScope(ctx), generationId);
  }

  @Get('outputs/:outputId/content')
  @RequirePermission(VIEW)
  async outputContent(
    @RequestContextData() ctx: RequestContext,
    @Param('outputId', ParseUUIDPipe) outputId: string,
    @Res() response: Response,
  ) {
    const { asset, file } = await this.generation.readOutput(
      creativeStudioScope(ctx),
      outputId,
    );
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }

  @Post('outputs/:outputId/promote') @RequirePermission(CREATE) promote(
    @RequestContextData() ctx: RequestContext,
    @Param('outputId', ParseUUIDPipe) outputId: string,
    @Body() dto: PromoteGeneratedOutputDto,
  ) {
    return this.generation.promoteToNewAsset(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      outputId,
      dto,
    );
  }

  @Post('outputs/:outputId/promote-as-version')
  @RequirePermission(UPDATE)
  promoteAsVersion(
    @RequestContextData() ctx: RequestContext,
    @Param('outputId', ParseUUIDPipe) outputId: string,
    @Body() dto: PromoteGeneratedOutputAsVersionDto,
  ) {
    return this.generation.promoteToVersion(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      outputId,
      dto,
    );
  }
}

/**
 * CS3.6.2 — variation of an immutable Creative Version, addressed where the
 * version lives (same convention as CS2B.2's `send-for-approval`). Answers
 * like `POST generations/images`: 202 + `statusPath`, `Idempotency-Key`.
 */
@Controller('social/creative-studio/assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeVersionVariationController {
  constructor(private readonly generation: CreativeImageGenerationService) {}

  @Post(':assetId/versions/:versionId/vary')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(CREATE)
  varyVersion(
    @RequestContextData() ctx: RequestContext,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: VaryCreativeImageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.generation.varyVersion(
      creativeStudioScope(ctx),
      ctx.userId ?? null,
      assetId,
      versionId,
      dto,
      idempotencyKey,
    );
  }
}
