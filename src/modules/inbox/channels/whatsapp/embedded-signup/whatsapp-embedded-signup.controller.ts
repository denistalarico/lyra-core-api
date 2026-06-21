import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../../../permissions';
import { CompleteWhatsAppEmbeddedSignupDto } from './dto/complete-whatsapp-embedded-signup.dto';
import { StartWhatsAppEmbeddedSignupDto } from './dto/start-whatsapp-embedded-signup.dto';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';

@Controller('inbox/channels/whatsapp/embedded-signup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class WhatsAppEmbeddedSignupController {
  constructor(
    private readonly whatsappEmbeddedSignupService: WhatsAppEmbeddedSignupService,
  ) {}

  @Post('start')
  @RequirePermission('leadflow.channels.channel.create.admin')
  async start(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: StartWhatsAppEmbeddedSignupDto,
  ) {
    const { tenantId, workspaceId, userId } = ctx;

    if (!tenantId || !workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.whatsappEmbeddedSignupService.start({
      tenantId,
      workspaceId,
      userId: userId ?? null,
      acceptedRules: dto.acceptedRules,
    });
  }

  @Get(':sessionId/status')
  @RequirePermission('leadflow.channels.channel.create.admin')
  async status(@Param('sessionId') sessionId: string) {
    return this.whatsappEmbeddedSignupService.getStatus(sessionId);
  }

  @Post('complete')
  @RequirePermission('leadflow.channels.channel.create.admin')
  async complete(@Body() dto: CompleteWhatsAppEmbeddedSignupDto) {
    return this.whatsappEmbeddedSignupService.complete({
      sessionId: dto.sessionId,
      state: dto.state,
      code: dto.code,
      businessId: dto.businessId,
      wabaId: dto.wabaId,
      phoneNumberId: dto.phoneNumberId,
      displayPhoneNumber: dto.displayPhoneNumber,
      phoneRegistrationPin: dto.phoneRegistrationPin,
      payload: dto.payload,
      metadata: dto.metadata,
    });
  }
}
