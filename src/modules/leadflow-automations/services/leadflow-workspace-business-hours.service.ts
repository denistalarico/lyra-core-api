import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import {
  normalizeBusinessHoursSchedule,
  type BusinessHoursSchedule,
} from './business-hours-schedule';

const AGENCY_CONNECTION = 'agency';

/**
 * The workspace's own opening hours, as the rest of LeadFlow reads them.
 *
 * There is exactly one such schedule — `InboxSettings.businessHours` — and it
 * is what the closed-hours detector and the context loader already judge by.
 * Exposing it through one service keeps the automation screen showing the same
 * hours the runtime will use, instead of a second copy that drifts.
 */
@Injectable()
export class LeadFlowWorkspaceBusinessHoursService {
  constructor(
    @InjectRepository(InboxSettingsEntity, AGENCY_CONNECTION)
    private readonly settings: Repository<InboxSettingsEntity>,
  ) {}

  /** `null` when the workspace has never configured its hours. */
  async getSchedule(scope: {
    tenantId: string;
    workspaceId?: string;
  }): Promise<BusinessHoursSchedule | null> {
    if (!scope.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const settings = await this.settings.findOne({
      where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
      select: { id: true, businessHours: true },
    });
    return normalizeBusinessHoursSchedule(settings?.businessHours ?? null);
  }
}
