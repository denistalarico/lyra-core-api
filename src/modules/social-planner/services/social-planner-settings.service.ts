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
import type { SocialPlannerSettings } from '../contracts';
import { UpdateSocialPlannerSettingsDto } from '../dto';
import { SocialPlannerSettingsEntity } from '../entities';
import { DEFAULT_SOCIAL_PLANNER_SETTINGS } from '../social-planner.defaults';
import type { SocialPlannerScope } from './social-planner.service';

@Injectable()
export class SocialPlannerSettingsService {
  constructor(
    @InjectRepository(SocialPlannerSettingsEntity, 'agency')
    private readonly settingsRepository: Repository<SocialPlannerSettingsEntity>,
  ) {}

  async getSettings(scope: SocialPlannerScope) {
    const row = await this.findSettings(scope);

    if (!row) {
      return {
        settings: this.cloneDefaults(),
        persisted: false,
        updatedAt: null,
      };
    }

    return {
      settings: this.toSettings(row),
      persisted: true,
      updatedAt: row.updatedAt,
    };
  }

  async updateSettings(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: UpdateSocialPlannerSettingsDto,
  ) {
    if (dto.funnelDistribution !== undefined) {
      this.assertFunnelDistribution(dto.funnelDistribution);
    }

    if (dto.contentTypes !== undefined) {
      this.assertUniqueCatalogKeys('contentTypes', dto.contentTypes);
    }

    if (dto.objectives !== undefined) {
      this.assertUniqueCatalogKeys('objectives', dto.objectives);
    }

    if (dto.creativeFormats !== undefined) {
      this.assertUniqueCatalogKeys(
        'creativeFormats',
        dto.creativeFormats,
      );
    }

    if (dto.ctaDefaults !== undefined) {
      this.assertCtaDefaults(dto.ctaDefaults);
    }

    if (dto.milestones !== undefined) {
      this.assertUniqueCatalogKeys('milestones', dto.milestones);
    }

    const existing = await this.findSettings(scope);

    const current: SocialPlannerSettings = existing
      ? this.toSettings(existing)
      : this.cloneDefaults();

    const next: SocialPlannerSettings = {
      monthlyContentVolume:
        dto.monthlyContentVolume ??
        current.monthlyContentVolume,

      funnelDistribution:
        dto.funnelDistribution ??
        current.funnelDistribution,

      contentTypes:
        dto.contentTypes ??
        current.contentTypes,

      objectives:
        dto.objectives ??
        current.objectives,

      creativeFormats:
        dto.creativeFormats ??
        current.creativeFormats,

      ctaDefaults:
        dto.ctaDefaults ??
        current.ctaDefaults,

      hashtagDefaults:
        dto.hashtagDefaults ??
        current.hashtagDefaults,

      firstCommentDefaults:
        dto.firstCommentDefaults ??
        current.firstCommentDefaults,

      hookLibrary:
        dto.hookLibrary !== undefined
          ? this.normalizeStrings(dto.hookLibrary)
          : current.hookLibrary,

      milestones:
        dto.milestones ??
        current.milestones,
    };

    const row =
      existing ??
      this.settingsRepository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        createdById: actorUserId,
      });

    row.monthlyContentVolume = next.monthlyContentVolume;
    row.funnelDistribution = next.funnelDistribution;
    row.contentTypes = next.contentTypes;
    row.objectives = next.objectives;
    row.creativeFormats = next.creativeFormats;
    row.ctaDefaults = next.ctaDefaults;
    row.hashtagDefaults = next.hashtagDefaults;
    row.firstCommentDefaults = next.firstCommentDefaults;
    row.hookLibrary = next.hookLibrary;
    row.milestones = next.milestones;

    row.updatedById = actorUserId;

    const saved = await this.settingsRepository.save(row);

    return {
      settings: this.toSettings(saved),
      persisted: true,
      updatedAt: saved.updatedAt,
    };
  }

  private findSettings(scope: SocialPlannerScope) {
    return this.settingsRepository.findOne({
      where: this.scopeWhere(scope),
    });
  }

  private scopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialPlannerSettingsEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null
          ? IsNull()
          : scope.agencyClientId,
    };
  }

  private toSettings(
    row: SocialPlannerSettingsEntity,
  ): SocialPlannerSettings {
    return {
      monthlyContentVolume: row.monthlyContentVolume,
      funnelDistribution: row.funnelDistribution,
      contentTypes: row.contentTypes,
      objectives: row.objectives,
      creativeFormats: row.creativeFormats,
      ctaDefaults: row.ctaDefaults,
      hashtagDefaults: row.hashtagDefaults,
      firstCommentDefaults: row.firstCommentDefaults,
      hookLibrary: row.hookLibrary,
      milestones: row.milestones,
    };
  }

  private cloneDefaults(): SocialPlannerSettings {
    return structuredClone(DEFAULT_SOCIAL_PLANNER_SETTINGS);
  }

  private assertFunnelDistribution(
    distribution: {
      discovery: number;
      recognition: number;
      consideration: number;
      decision: number;
    },
  ): void {
    const total =
      distribution.discovery +
      distribution.recognition +
      distribution.consideration +
      distribution.decision;

    if (Math.abs(total - 100) > 0.001) {
      throw new BadRequestException(
        'Funnel distribution must total 100%.',
      );
    }
  }

  private assertUniqueCatalogKeys(
    field: string,
    items: Array<{ key: string }>,
  ): void {
    const keys = items.map((item) => item.key);

    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException(
        `${field} contains duplicate keys.`,
      );
    }
  }

  private assertCtaDefaults(
    defaults: Record<string, string[]>,
  ): void {
    for (const [objectiveKey, values] of Object.entries(defaults)) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(objectiveKey)) {
        throw new BadRequestException(
          `Invalid CTA objective key "${objectiveKey}".`,
        );
      }

      if (!Array.isArray(values)) {
        throw new BadRequestException(
          `CTA defaults for "${objectiveKey}" must be an array.`,
        );
      }

      for (const value of values) {
        if (
          typeof value !== 'string' ||
          value.trim().length === 0 ||
          value.length > 300
        ) {
          throw new BadRequestException(
            `Invalid CTA value for "${objectiveKey}".`,
          );
        }
      }
    }
  }

  private normalizeStrings(values: string[]): string[] {
    const normalized = values
      .map((value) => value.trim())
      .filter(Boolean);

    return [...new Set(normalized)];
  }
}
