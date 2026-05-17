import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { CompleteWhatsAppEmbeddedSignupDto } from './dto/complete-whatsapp-embedded-signup.dto';
import { StartWhatsAppEmbeddedSignupDto } from './dto/start-whatsapp-embedded-signup.dto';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';

@Controller('inbox/channels/whatsapp/embedded-signup')
export class WhatsAppEmbeddedSignupController {
  constructor(
    private readonly whatsappEmbeddedSignupService: WhatsAppEmbeddedSignupService,
  ) {}

  @Post('start')
  async start(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: StartWhatsAppEmbeddedSignupDto,
  ) {
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
  async status(@Param('sessionId') sessionId: string) {
    return this.whatsappEmbeddedSignupService.getStatus(sessionId);
  }

  @Post('complete')
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
