import {
  BadRequestException,
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import { readRequestedManagedContext } from '../../common/context/managed-context.contract';
import { PlatformContextService } from './platform-context.service';

@Controller('platform')
export class PlatformContextController {
  constructor(
    private readonly platformContextService: PlatformContextService,
  ) {}

  @Get('context')
  @UseGuards(JwtAuthGuard)
  getContext(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Req() request: Request,
  ) {
    if (!user.sub || !user.tenantId || !user.workspaceId) {
      throw new BadRequestException('Missing authenticated workspace context.');
    }

    return this.platformContextService.getContext({
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
      role: user.role,
      // Headers only *request* a context; the service answers with the one
      // it accepted, plus a rejection reason when they disagree.
      requestedContext: readRequestedManagedContext(request.headers),
    });
  }
}
