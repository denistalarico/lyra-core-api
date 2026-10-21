import { Header } from '@nestjs/common';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ClientAreaSettingsRegistry } from '../../../common/client-area-bridge/client-area-settings.registry';
import { ClientAreaContextData } from '../client-area.decorators';
import type {
  ClientAreaContext,
  ClientAreaModuleKey,
} from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../guards/client-area.guards';
import { UpdateBusinessProfileDto } from '../../platform-settings/dto/update-business-profile.dto';
import { PublishCompanyContextDto } from '../../leadflow-settings/dto/publish-company-context.dto';
import { ClientAreaRateLimitService } from '../services/client-area-rate-limit.service';

export const CLIENT_AREA_INTEGRATION_PROVIDERS = [
  'meta_ads',
  'facebook',
  'instagram_facebook',
  'instagram_direct',
  'inbox_instagram',
  'inbox_messenger',
  'inbox_whatsapp',
] as const;
export type ClientAreaIntegrationProvider =
  (typeof CLIENT_AREA_INTEGRATION_PROVIDERS)[number];
export class ClientAreaConnectIntegrationDto {
  @IsOptional() @IsBoolean() acceptedRules?: boolean;
}
export class ClientAreaSelectIntegrationDto {
  @IsUUID() connectionId!: string;
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  externalIds!: string[];
}
export class ClientAreaCompleteWhatsAppDto {
  @IsUUID() sessionId!: string;
  @IsString() @MaxLength(512) state!: string;
  @IsString() @MaxLength(4096) code!: string;
  @IsOptional() @IsString() @MaxLength(128) wabaId?: string;
  @IsOptional() @IsString() @MaxLength(128) phoneNumberId?: string;
  @IsOptional() @IsString() @MaxLength(128) businessId?: string;
  @IsOptional() @IsString() @MaxLength(64) displayPhoneNumber?: string;
  @IsOptional() @IsString() @MaxLength(6) phoneRegistrationPin?: string;
}
export class ClientAreaProviderParamDto {
  @IsUUID() companyContextId!: string;
  @IsOptional() @IsUUID() connectionId?: string;
  @IsOptional() @IsUUID() sessionId?: string;
  @IsIn(CLIENT_AREA_INTEGRATION_PROVIDERS)
  provider!: ClientAreaIntegrationProvider;
}

@Controller('client-area/companies/:companyContextId/settings')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
export class ClientAreaProductSettingsController {
  constructor(
    private readonly registry: ClientAreaSettingsRegistry,
    private readonly limits: ClientAreaRateLimitService,
  ) {}
  private owner(ctx: ClientAreaContext, module?: ClientAreaModuleKey) {
    if (ctx.role !== 'client_owner')
      throw new ForbiddenException('Only the Owner can manage these settings.');
    if (module && !ctx.modules[module])
      throw new ForbiddenException('Module is unavailable.');
  }
  private integration(
    ctx: ClientAreaContext,
    provider: ClientAreaIntegrationProvider,
  ) {
    this.owner(
      ctx,
      provider.startsWith('inbox_')
        ? 'leadflow_inbox'
        : provider === 'meta_ads'
          ? 'social_campaigns'
          : 'social_planner',
    );
  }
  private mutation(ctx: ClientAreaContext) {
    this.limits.consume({ security_identity: `${ctx.tenantId}:${ctx.userId}` });
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('business')
  business(@ClientAreaContextData() ctx: ClientAreaContext) {
    this.owner(ctx);
    return this.registry.call('business.get', ctx);
  }
  @Header('Cache-Control', 'private, no-store')
  @Patch('business')
  updateBusiness(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    this.owner(ctx);
    return this.registry.call('business.update', ctx, dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('business/publish')
  @HttpCode(200)
  publishBusiness(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: PublishCompanyContextDto,
  ) {
    this.owner(ctx);
    return this.registry.call('business.publish', ctx, dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('business/modes')
  modes(@ClientAreaContextData() ctx: ClientAreaContext) {
    this.owner(ctx);
    return this.registry.call('business.modes', ctx);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('integrations/:provider')
  connections(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param() params: ClientAreaProviderParamDto,
  ) {
    this.integration(ctx, params.provider);
    return this.registry.call('integrations.list', ctx, {
      provider: params.provider,
    });
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('integrations/:provider/connect')
  @HttpCode(200)
  connect(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param() params: ClientAreaProviderParamDto,
    @Body() dto: ClientAreaConnectIntegrationDto,
  ) {
    this.integration(ctx, params.provider);
    this.mutation(ctx);
    return this.registry.call('integrations.connect', ctx, {
      provider: params.provider,
      acceptedRules: dto.acceptedRules,
    });
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('integrations/:provider/select')
  @HttpCode(200)
  select(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param() params: ClientAreaProviderParamDto,
    @Body() dto: ClientAreaSelectIntegrationDto,
  ) {
    this.integration(ctx, params.provider);
    this.mutation(ctx);
    return this.registry.call('integrations.select', ctx, {
      provider: params.provider,
      connectionId: dto.connectionId,
      externalIds: dto.externalIds,
    });
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('integrations/:provider/sessions/:sessionId')
  session(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param() params: ClientAreaProviderParamDto,
    @Param('sessionId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    sessionId: string,
  ) {
    this.integration(ctx, params.provider);
    return this.registry.call('integrations.session', ctx, {
      provider: params.provider,
      sessionId,
    });
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('integrations/inbox_whatsapp/complete')
  @HttpCode(200)
  completeWhatsApp(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: ClientAreaCompleteWhatsAppDto,
  ) {
    this.integration(ctx, 'inbox_whatsapp');
    this.mutation(ctx);
    return this.registry.call('integrations.whatsapp.complete', ctx, dto);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('integrations/:provider/:connectionId/disconnect')
  @HttpCode(200)
  disconnect(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param() params: ClientAreaProviderParamDto,
    @Param('connectionId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    connectionId: string,
    @Headers('idempotency-key') key?: string,
  ) {
    this.integration(ctx, params.provider);
    this.mutation(ctx);
    return this.registry.call('integrations.disconnect', ctx, {
      provider: params.provider,
      connectionId,
      key,
    });
  }
}
