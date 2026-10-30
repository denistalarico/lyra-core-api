import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
} from '../guards/client-area.guards';
import type { ClientAreaRequest } from '../client-area.types';
import { ClientAreaIdentityPreferencesEntity } from '../entities/client-area-identity-preferences.entity';
import { PatchClientAreaPreferencesDto } from '../dto/client-area-preferences.dto';

@Controller('client-area/me/preferences')
@UseGuards(ClientAreaEnabledGuard, ClientAreaAuthGuard)
export class ClientAreaPreferencesController {
  constructor(
    @InjectRepository(ClientAreaIdentityPreferencesEntity, 'agency')
    private readonly repo: Repository<ClientAreaIdentityPreferencesEntity>,
  ) {}
  @Get() async get(@Req() req: ClientAreaRequest) {
    const { tenantId, userId } = req.clientAreaIdentity!;
    const row = await this.repo.findOne({ where: { tenantId, userId } });
    return {
      theme: row?.theme ?? 'system',
      locale: row?.locale ?? 'pt-BR',
      sidebarCollapsed: row?.sidebarCollapsed ?? false,
    };
  }
  @Patch() async patch(
    @Req() req: ClientAreaRequest,
    @Body() dto: PatchClientAreaPreferencesDto,
  ) {
    const { tenantId, userId } = req.clientAreaIdentity!;
    if (
      dto.theme !== undefined ||
      dto.locale !== undefined ||
      dto.sidebarCollapsed !== undefined
    )
      await this.repo.upsert(
        {
          tenantId,
          userId,
          ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.sidebarCollapsed !== undefined
            ? { sidebarCollapsed: dto.sidebarCollapsed }
            : {}),
        },
        ['tenantId', 'userId'],
      );
    return this.get(req);
  }
}
