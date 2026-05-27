import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateFinanceFiscalProfileDto } from '../dto';
import { FinanceFiscalProfile } from '../entities';
import { FinanceRequestContext } from './finance-context';

@Injectable()
export class FinanceFiscalService {
  constructor(
    @InjectRepository(FinanceFiscalProfile, 'agency')
    private readonly fiscalProfilesRepo: Repository<FinanceFiscalProfile>,
  ) {}

  async getProfile(ctx: FinanceRequestContext) {
    return this.findOrCreateProfile(ctx);
  }

  async updateProfile(ctx: FinanceRequestContext, dto: UpdateFinanceFiscalProfileDto) {
    const profile = await this.findOrCreateProfile(ctx);

    Object.assign(profile, {
      ...dto,
      fiscalCountry: dto.fiscalCountry?.toUpperCase() ?? profile.fiscalCountry,
      metadata: dto.metadata ?? profile.metadata,
      providerConfig: dto.providerConfig ?? profile.providerConfig,
      certificateExpiresAt:
        dto.certificateExpiresAt === undefined
          ? profile.certificateExpiresAt
          : dto.certificateExpiresAt
            ? new Date(dto.certificateExpiresAt)
            : null,
    });

    return this.fiscalProfilesRepo.save(profile);
  }

  private async findOrCreateProfile(ctx: FinanceRequestContext) {
    let profile = await this.fiscalProfilesRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!profile) {
      profile = await this.fiscalProfilesRepo.save(
        this.fiscalProfilesRepo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          fiscalCountry: 'BR',
        }),
      );
    }

    return profile;
  }
}
