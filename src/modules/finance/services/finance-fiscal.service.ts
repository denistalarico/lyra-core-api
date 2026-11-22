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

  async updateProfile(
    ctx: FinanceRequestContext,
    dto: UpdateFinanceFiscalProfileDto,
  ) {
    const scope = { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
    await this.fiscalProfilesRepo.upsert(
      {
        ...scope,
        ...dto,
        fiscalCountry: dto.fiscalCountry?.toUpperCase(),
        metadata: (dto.metadata ?? undefined) as never,
        providerConfig: (dto.providerConfig ?? undefined) as never,
      },
      ['tenantId', 'workspaceId'],
    );
    return this.fiscalProfilesRepo.findOneByOrFail(scope);
  }

  private async findOrCreateProfile(ctx: FinanceRequestContext) {
    const scope = { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
    const profile = await this.fiscalProfilesRepo.findOneBy(scope);
    if (profile) return profile;

    await this.fiscalProfilesRepo.createQueryBuilder().insert().values(scope)
      .orIgnore().execute();
    return this.fiscalProfilesRepo.findOneByOrFail(scope);
  }
}
