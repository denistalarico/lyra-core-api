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
      metadata: this.metadataFromContext(ctx),
    });
  }

  @Get(':sessionId/status')
  @RequirePermission('leadflow.channels.channel.create.admin')
  async status(
    @RequestContextData() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
  ) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return this.whatsappEmbeddedSignupService.getStatus(
      sessionId,
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Post('complete')
  @RequirePermission('leadflow.channels.channel.create.admin')
  async complete(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CompleteWhatsAppEmbeddedSignupDto,
  ) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return this.whatsappEmbeddedSignupService.complete({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
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

  private metadataFromContext(ctx: RequestContext) {
    const managedContext = ctx.managedContext;

    if (!managedContext) {
      return {
        setupSource: 'embedded_signup',
      };
    }

    return {
      setupSource: 'embedded_signup',
      productKey: managedContext.productKey,
      operatingMode: managedContext.operatingMode,
      clientId: managedContext.clientId,
      clientName: managedContext.clientName ?? null,
      managedTenantId: managedContext.managedTenantId,
    };
  }
}
