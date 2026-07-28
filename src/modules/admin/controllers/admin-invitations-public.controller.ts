import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractLoginContext } from '../../auth/utils/login-context.util';
import {
  AcceptAdminInvitationDto,
  ValidateAdminInvitationQueryDto,
} from '../dto/admin-internal-users.dto';
import { AdminBrowserOriginGuard } from '../guards/admin-browser-origin.guard';
import { AdminInvitationsService } from '../services/admin-invitations.service';

@Controller('admin/internal-users/invitations')
@UseGuards(AdminBrowserOriginGuard)
export class AdminInvitationsPublicController {
  constructor(private readonly invitationsService: AdminInvitationsService) {}

  @Get('validate')
  validate(@Query() query: ValidateAdminInvitationQueryDto) {
    return this.invitationsService.validate(query.token);
  }

  @Post('accept')
  accept(@Body() dto: AcceptAdminInvitationDto, @Req() request: Request) {
    return this.invitationsService.accept(
      dto.token,
      extractLoginContext(request),
    );
  }
}
