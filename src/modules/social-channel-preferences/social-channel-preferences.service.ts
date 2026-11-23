import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  SocialChannelPreferenceEntity,
  type SocialToggleableChannel,
} from './social-channel-preference.entity';

const scopeWhere = (scope: CompanyAwareScope) => ({
  tenantId: scope.tenantId,
  workspaceId: scope.workspaceId,
  agencyClientId: scope.agencyClientId ?? IsNull(),
  companyContextId: scope.companyContextId ?? IsNull(),
});

@Injectable()
export class SocialChannelPreferencesService {
  constructor(
    @InjectRepository(SocialChannelPreferenceEntity, 'agency')
    private readonly preferences: Repository<SocialChannelPreferenceEntity>,
  ) {}

  /** The channels switched off in this context. */
  async disabled(scope: CompanyAwareScope): Promise<SocialToggleableChannel[]> {
    const rows = await this.preferences.find({
      where: { ...scopeWhere(scope), enabled: false },
      order: { channel: 'ASC' },
    });
    return rows.map((row) => row.channel);
  }

  async set(
    scope: CompanyAwareScope,
    channel: SocialToggleableChannel,
    enabled: boolean,
    userId: string | null,
  ): Promise<SocialToggleableChannel[]> {
    const existing = await this.preferences.findOne({
      where: { ...scopeWhere(scope), channel },
    });
    if (existing) {
      existing.enabled = enabled;
      existing.updatedById = userId;
      await this.preferences.save(existing);
    } else if (!enabled) {
      await this.preferences.save(
        this.preferences.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId,
          channel,
          enabled,
          updatedById: userId,
        }),
      );
    }
    return this.disabled(scope);
  }
}
