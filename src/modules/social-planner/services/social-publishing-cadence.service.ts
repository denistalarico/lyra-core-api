import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IsNull,
  type FindOptionsWhere,
  Repository,
} from 'typeorm';
import type {
  SocialPublishingCadence,
  SocialPublishingCadenceChannel,
} from '../contracts';
import { UpdateSocialPublishingCadenceDto } from '../dto';
import { SocialPublishingCadenceEntity } from '../entities';
import { DEFAULT_SOCIAL_PUBLISHING_CADENCE } from '../social-publishing-cadence.defaults';
import type { SocialPlannerScope } from './social-planner.service';
import { SocialPlannerSettingsService } from './social-planner-settings.service';

@Injectable()
export class SocialPublishingCadenceService {
  constructor(
    @InjectRepository(SocialPublishingCadenceEntity, 'agency')
    private readonly cadenceRepository: Repository<SocialPublishingCadenceEntity>,

    private readonly plannerSettingsService: SocialPlannerSettingsService,
  ) {}

  async getCadence(scope: SocialPlannerScope) {
    const [row, plannerSettingsResult] = await Promise.all([
      this.findCadence(scope),
      this.plannerSettingsService.getSettings(scope),
    ]);

    const cadence = row
      ? this.toCadence(row)
      : this.cloneDefaults();

    return {
      cadence,
      effectiveChannels: cadence.channels.map((channel) =>
        this.toEffectiveChannel(
          channel,
          plannerSettingsResult.settings.monthlyContentVolume,
        ),
      ),
      inheritedMonthlyContentVolume:
        plannerSettingsResult.settings.monthlyContentVolume,
      persisted: Boolean(row),
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async updateCadence(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: UpdateSocialPublishingCadenceDto,
  ) {
    if (dto.timezone !== undefined) {
      this.assertValidTimezone(dto.timezone);
    }

    if (dto.channels !== undefined) {
      this.assertChannels(dto.channels);
    }

    const existing = await this.findCadence(scope);

    const current: SocialPublishingCadence = existing
      ? this.toCadence(existing)
      : this.cloneDefaults();

    const next: SocialPublishingCadence = {
      timezone:
        dto.timezone !== undefined
          ? dto.timezone.trim()
          : current.timezone,

      autoDistributionEnabled:
        dto.autoDistributionEnabled ??
        current.autoDistributionEnabled,

      channels:
        dto.channels !== undefined
          ? this.normalizeChannels(dto.channels)
          : current.channels,
    };

    this.assertValidTimezone(next.timezone);
    this.assertChannels(next.channels);

    const row =
      existing ??
      this.cadenceRepository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        createdById: actorUserId,
      });

    row.timezone = next.timezone;
    row.autoDistributionEnabled =
      next.autoDistributionEnabled;
    row.channels = next.channels;
    row.updatedById = actorUserId;

    const saved = await this.cadenceRepository.save(row);

    const plannerSettings =
      await this.plannerSettingsService.getSettings(scope);

    const cadence = this.toCadence(saved);

    return {
      cadence,
      effectiveChannels: cadence.channels.map((channel) =>
        this.toEffectiveChannel(
          channel,
          plannerSettings.settings.monthlyContentVolume,
        ),
      ),
      inheritedMonthlyContentVolume:
        plannerSettings.settings.monthlyContentVolume,
      persisted: true,
      updatedAt: saved.updatedAt,
    };
  }

  private findCadence(scope: SocialPlannerScope) {
    return this.cadenceRepository.findOne({
      where: this.scopeWhere(scope),
    });
  }

  private scopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialPublishingCadenceEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null
          ? IsNull()
          : scope.agencyClientId,
    };
  }

  private toCadence(
    row: SocialPublishingCadenceEntity,
  ): SocialPublishingCadence {
    return {
      timezone: row.timezone,
      autoDistributionEnabled:
        row.autoDistributionEnabled,
      channels: row.channels,
    };
  }

  private cloneDefaults(): SocialPublishingCadence {
    return structuredClone(
      DEFAULT_SOCIAL_PUBLISHING_CADENCE,
    );
  }

  private toEffectiveChannel(
    channel: SocialPublishingCadenceChannel,
    inheritedMonthlyContentVolume: number,
  ) {
    return {
      ...channel,
      effectiveFrequencyPerMonth:
        channel.frequencyPerMonth ??
        inheritedMonthlyContentVolume,
      frequencyInherited:
        channel.frequencyPerMonth === null,
    };
  }

  private assertChannels(
    channels: Array<{
      channel: string;
      enabled: boolean;
      frequencyPerMonth?: number | null;
      slots: Array<{
        dayOfWeek: number;
        time: string;
      }>;
    }>,
  ): void {
    const channelKeys = new Set<string>();

    for (const channel of channels) {
      if (channelKeys.has(channel.channel)) {
        throw new BadRequestException(
          `Duplicate cadence channel "${channel.channel}".`,
        );
      }

      channelKeys.add(channel.channel);

      const slotKeys = new Set<string>();

      for (const slot of channel.slots) {
        if (
          !Number.isInteger(slot.dayOfWeek) ||
          slot.dayOfWeek < 0 ||
          slot.dayOfWeek > 6
        ) {
          throw new BadRequestException(
            `Invalid dayOfWeek for channel "${channel.channel}".`,
          );
        }

        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)
        ) {
          throw new BadRequestException(
            `Invalid time "${slot.time}" for channel "${channel.channel}".`,
          );
        }

        const slotKey =
          `${slot.dayOfWeek}:${slot.time}`;

        if (slotKeys.has(slotKey)) {
          throw new BadRequestException(
            `Duplicate cadence slot "${slotKey}" for channel "${channel.channel}".`,
          );
        }

        slotKeys.add(slotKey);
      }
    }
  }

  private normalizeChannels(
    channels: Array<{
      channel: string;
      enabled: boolean;
      frequencyPerMonth?: number | null;
      slots: Array<{
        dayOfWeek: number;
        time: string;
      }>;
    }>,
  ): SocialPublishingCadenceChannel[] {
    return channels.map((channel) => ({
      channel: channel.channel.trim(),
      enabled: channel.enabled,
      frequencyPerMonth:
        channel.frequencyPerMonth ?? null,
      slots: channel.slots
        .map((slot) => ({
          dayOfWeek: slot.dayOfWeek,
          time: slot.time,
        }))
        .sort(
          (a, b) =>
            a.dayOfWeek - b.dayOfWeek ||
            a.time.localeCompare(b.time),
        ),
    }));
  }

  private assertValidTimezone(timezone: string): void {
    const normalized = timezone.trim();

    if (!normalized) {
      throw new BadRequestException(
        'Publishing cadence timezone is required.',
      );
    }

    try {
      new Intl.DateTimeFormat('en-US', {
        timeZone: normalized,
      }).format();
    } catch {
      throw new BadRequestException(
        `Invalid IANA timezone "${timezone}".`,
      );
    }
  }
}
