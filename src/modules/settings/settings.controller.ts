// src/modules/settings/settings.controller.ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PatchUserPreferencesDto } from './dto/patch-user-preferences.dto';
import { PatchWorkspaceAiSettingsDto } from './dto/patch-workspace-ai-settings.dto';
import { PatchWorkspaceCompanySettingsDto } from './dto/patch-workspace-company-settings.dto';
import { RequestContextData } from '../../common/context/request-context.decorator';
import { PatchWorkspaceCompanyBrandAssetsDto } from './dto/patch-workspace-company-brand-assets.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('preferences')
  async getPreferences(@RequestContextData() ctx: any) {
    return this.settingsService.getPreferences(ctx.tenantId, ctx.userId);
  }

  @Patch('preferences')
  async patchPreferences(
    @RequestContextData() ctx: any,
    @Body() dto: PatchUserPreferencesDto,
  ) {
    return this.settingsService.patchPreferences(ctx.tenantId, ctx.userId, dto);
  }

  @Get('ai')
  async getAi(@RequestContextData() ctx: any) {
    return this.settingsService.getAi(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('ai')
  async patchAi(
    @RequestContextData() ctx: any,
    @Body() dto: PatchWorkspaceAiSettingsDto,
  ) {
    return this.settingsService.patchAi(ctx.tenantId, ctx.workspaceId, dto);
  }

  @Get('company')
  async getCompany(@RequestContextData() ctx: any) {
    return this.settingsService.getCompany(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('company')
  async patchCompany(
    @RequestContextData() ctx: any,
    @Body() dto: PatchWorkspaceCompanySettingsDto,
  ) {
    return this.settingsService.patchCompany(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Patch('company/brand-assets')
  async patchCompanyBrandAssets(
    @RequestContextData() ctx: any,
    @Body() dto: PatchWorkspaceCompanyBrandAssetsDto,
  ) {
    return this.settingsService.patchCompanyBrandAssets(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }
}
