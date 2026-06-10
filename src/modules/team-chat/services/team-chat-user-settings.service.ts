import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AgencyChatUserSettings } from '../entities';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class TeamChatUserSettingsService {
  constructor(
    @InjectRepository(AgencyChatUserSettings, AGENCY_CONNECTION)
    private readonly settingsRepository: Repository<AgencyChatUserSettings>,
  ) {}

  async get(context: TeamChatContext): Promise<Record<string, unknown>> {
    if (!context.userId) return {};

    const record = await this.settingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });

    return record?.data ?? {};
  }

  async upsert(
    context: TeamChatContext,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!context.userId) return data;

    const existing = await this.settingsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
    });

    if (existing) {
      existing.data = data;
      const saved = await this.settingsRepository.save(existing);
      return saved.data;
    }

    const created = await this.settingsRepository.save(
      this.settingsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        userId: context.userId,
        data,
      }),
    );

    return created.data;
  }
}
