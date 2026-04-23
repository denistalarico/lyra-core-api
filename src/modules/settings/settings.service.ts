// src/modules/settings/settings.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatchUserPreferencesDto } from './dto/patch-user-preferences.dto';
import { PatchWorkspaceAiSettingsDto } from './dto/patch-workspace-ai-settings.dto';
import { PatchWorkspaceCompanySettingsDto } from './dto/patch-workspace-company-settings.dto';
import { UserPreferencesEntity } from './entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from './entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from './entities/workspace-settings-company.entity';
import { PatchWorkspaceCompanyBrandAssetsDto } from './dto/patch-workspace-company-brand-assets.dto';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(UserPreferencesEntity)
    private readonly userPreferencesRepo: Repository<UserPreferencesEntity>,
    @InjectRepository(WorkspaceSettingsAiEntity)
    private readonly aiRepo: Repository<WorkspaceSettingsAiEntity>,
    @InjectRepository(WorkspaceSettingsCompanyEntity)
    private readonly companyRepo: Repository<WorkspaceSettingsCompanyEntity>,
  ) {}

  async getPreferences(tenantId: string, userId: string) {
    const found = await this.userPreferencesRepo.findOne({
      where: { tenantId, userId },
    });

    return (
      found ??
      this.userPreferencesRepo.create({
        tenantId,
        userId,
      })
    );
  }

  async patchPreferences(
    tenantId: string,
    userId: string,
    dto: PatchUserPreferencesDto,
  ) {
    await this.userPreferencesRepo.upsert(
      {
        tenantId,
        userId,
        ...dto,
      },
      ['tenantId', 'userId'],
    );

    return this.getPreferences(tenantId, userId);
  }

  async getAi(tenantId: string, workspaceId: string) {
    const found = await this.aiRepo.findOne({
      where: { tenantId, workspaceId },
    });

    return (
      found ??
      this.aiRepo.create({
        tenantId,
        workspaceId,
      })
    );
  }

  async patchAi(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceAiSettingsDto,
  ) {
    await this.aiRepo.upsert(
      {
        tenantId,
        workspaceId,
        ...dto,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getAi(tenantId, workspaceId);
  }

  async getCompany(tenantId: string, workspaceId: string) {
    const found = await this.companyRepo.findOne({
      where: { tenantId, workspaceId },
    });

    return (
      found ??
      this.companyRepo.create({
        tenantId,
        workspaceId,
        legalName: '',
        publicName: '',
        workspaceName: '',
        taxIdType: 'cnpj',
        taxIdCustomLabel: null,
        taxId: '',
        description: null,
        primaryColor: '#2563EB',
        secondaryColor: '#0F172A',
        supportEmail: null,
        phone: null,
        website: null,
        instagramHandle: null,
        facebookUrl: null,
        linkedinUrl: null,
        country: 'Brazil',
        stateRegion: null,
        city: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        industry: null,
        companySize: null,
        timezone: 'America/Sao_Paulo',
      })
    );
  }

  async patchCompany(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceCompanySettingsDto,
  ) {
    await this.companyRepo.upsert(
      {
        tenantId,
        workspaceId,
        ...dto,
        taxIdCustomLabel: dto.taxIdCustomLabel ?? null,
        description: dto.description ?? null,
        supportEmail: dto.supportEmail ?? null,
        phone: dto.phone ?? null,
        website: dto.website ?? null,
        instagramHandle: dto.instagramHandle ?? null,
        facebookUrl: dto.facebookUrl ?? null,
        linkedinUrl: dto.linkedinUrl ?? null,
        stateRegion: dto.stateRegion ?? null,
        city: dto.city ?? null,
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        postalCode: dto.postalCode ?? null,
        industry: dto.industry ?? null,
        companySize: dto.companySize ?? null,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getCompany(tenantId, workspaceId);
  }

  async patchCompanyBrandAssets(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceCompanyBrandAssetsDto,
  ) {
    const existing = await this.companyRepo.findOne({
      where: { tenantId, workspaceId },
    });

    const brandAssets = {
      brandLogoUrl: dto.brandLogoUrl ?? null,
      brandLogoAssetKey: dto.brandLogoAssetKey ?? null,
    };

    if (!existing) {
      await this.companyRepo.insert({
        tenantId,
        workspaceId,
        legalName: '',
        publicName: '',
        workspaceName: '',
        taxIdType: 'cnpj',
        taxIdCustomLabel: null,
        taxId: '',
        description: null,
        primaryColor: '#2563EB',
        secondaryColor: '#0F172A',
        supportEmail: null,
        phone: null,
        website: null,
        instagramHandle: null,
        facebookUrl: null,
        linkedinUrl: null,
        country: 'Brazil',
        stateRegion: null,
        city: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        industry: null,
        companySize: null,
        timezone: 'America/Sao_Paulo',
        ...brandAssets,
      });
    } else {
      await this.companyRepo.update({ tenantId, workspaceId }, brandAssets);
    }

    return this.getCompany(tenantId, workspaceId);
  }
}
