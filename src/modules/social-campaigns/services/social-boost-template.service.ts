import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  ILike,
  IsNull,
  Not,
  type FindOptionsWhere,
  Repository,
} from 'typeorm';
import type {
  CreateSocialBoostTemplateDto,
  SocialBoostAudienceDto,
  UpdateSocialBoostTemplateDto,
} from '../dto';
import {
  SocialBoostTemplateEntity,
  type SocialBoostAudience,
} from '../entities';
import { toSocialBoostTemplateView } from '../views/social-boost-template.view';

export type SocialCampaignsScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
};

const EMPTY_AUDIENCE: SocialBoostAudience = {
  countries: [],
  ageMin: null,
  ageMax: null,
  genders: [],
  interests: [],
  savedAudienceExternalId: null,
};

@Injectable()
export class SocialBoostTemplateService {
  constructor(
    @InjectRepository(SocialBoostTemplateEntity, 'agency')
    private readonly repository: Repository<SocialBoostTemplateEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async list(scope: SocialCampaignsScope, includeInactive = false) {
    const items = await this.repository.find({
      where: {
        ...this.scopeWhere(scope),
        ...(includeInactive ? {} : { isActive: true }),
      },
      order: { isDefault: 'DESC', name: 'ASC' },
    });

    return { items: items.map(toSocialBoostTemplateView), total: items.length };
  }

  async create(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    dto: CreateSocialBoostTemplateDto,
  ) {
    const name = this.requireText(dto.name);
    await this.assertNameAvailable(scope, name, null);

    const audience = this.normalizeAudience(dto.audience);
    this.assertAudience(dto.audienceMode, audience);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SocialBoostTemplateEntity);
      const existingCount = await repository.count({
        where: this.scopeWhere(scope),
      });
      const isActive = dto.isActive ?? true;
      const isDefault = isActive && (dto.isDefault ?? existingCount === 0);

      if (isDefault) {
        await repository.update(
          { ...this.scopeWhere(scope), provider: dto.provider },
          { isDefault: false },
        );
      }

      const row = repository.create({
        ...scope,
        name,
        provider: dto.provider,
        objective: dto.objective,
        budgetType: dto.budgetType,
        budgetAmountMinor: String(dto.budgetAmountMinor),
        currency: dto.currency.trim().toUpperCase(),
        durationDays: dto.durationDays,
        audienceMode: dto.audienceMode,
        audience,
        placements: this.normalizeStrings(dto.placements ?? []),
        specialAdCategories: this.normalizeStrings(dto.specialAdCategories),
        callToAction: this.normalizeNullable(dto.callToAction),
        destinationUrl: this.normalizeNullable(dto.destinationUrl),
        isDefault,
        isActive,
        createdById: actorUserId,
        updatedById: actorUserId,
      });

      return toSocialBoostTemplateView(await repository.save(row));
    });
  }

  async update(
    scope: SocialCampaignsScope,
    templateId: string,
    actorUserId: string | null,
    dto: UpdateSocialBoostTemplateDto,
  ) {
    const current = await this.requireOne(scope, templateId);
    const name = dto.name === undefined ? current.name : this.requireText(dto.name);

    if (name !== current.name) {
      await this.assertNameAvailable(scope, name, current.id);
    }

    const audience =
      dto.audience === undefined
        ? current.audience
        : this.normalizeAudience(dto.audience);
    const audienceMode = dto.audienceMode ?? current.audienceMode;
    this.assertAudience(audienceMode, audience);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SocialBoostTemplateEntity);
      const row = await repository.findOne({
        where: { ...this.scopeWhere(scope), id: templateId },
      });

      if (!row) throw new NotFoundException('Boost template not found.');

      const nextActive = dto.isActive ?? row.isActive;
      const nextDefault = nextActive && (dto.isDefault ?? row.isDefault);
      if (nextDefault) {
        await repository.update(
          { ...this.scopeWhere(scope), provider: row.provider, id: Not(row.id) },
          { isDefault: false },
        );
      }

      row.name = name;
      row.objective = dto.objective ?? row.objective;
      row.budgetType = dto.budgetType ?? row.budgetType;
      row.budgetAmountMinor =
        dto.budgetAmountMinor === undefined
          ? row.budgetAmountMinor
          : String(dto.budgetAmountMinor);
      row.currency = dto.currency?.trim().toUpperCase() ?? row.currency;
      row.durationDays = dto.durationDays ?? row.durationDays;
      row.audienceMode = audienceMode;
      row.audience = audience;
      row.placements =
        dto.placements === undefined
          ? row.placements
          : this.normalizeStrings(dto.placements);
      row.specialAdCategories =
        dto.specialAdCategories === undefined
          ? row.specialAdCategories
          : this.normalizeStrings(dto.specialAdCategories);
      row.callToAction =
        dto.callToAction === undefined
          ? row.callToAction
          : this.normalizeNullable(dto.callToAction);
      row.destinationUrl =
        dto.destinationUrl === undefined
          ? row.destinationUrl
          : this.normalizeNullable(dto.destinationUrl);
      row.isDefault = nextDefault;
      row.isActive = nextActive;
      row.updatedById = actorUserId;

      return toSocialBoostTemplateView(await repository.save(row));
    });
  }

  private requireOne(scope: SocialCampaignsScope, id: string) {
    return this.repository.findOne({
      where: { ...this.scopeWhere(scope), id },
    }).then((row) => {
      if (!row) throw new NotFoundException('Boost template not found.');
      return row;
    });
  }

  private async assertNameAvailable(
    scope: SocialCampaignsScope,
    name: string,
    excludingId: string | null,
  ) {
    const row = await this.repository.findOne({
      where: {
        ...this.scopeWhere(scope),
        name: ILike(name),
        ...(excludingId ? { id: Not(excludingId) } : {}),
      },
    });

    if (row) {
      throw new ConflictException(
        'A Boost template with this name already exists.',
      );
    }
  }

  private scopeWhere(
    scope: SocialCampaignsScope,
  ): FindOptionsWhere<SocialBoostTemplateEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private normalizeAudience(
    input?: SocialBoostAudienceDto,
  ): SocialBoostAudience {
    return {
      countries: this.normalizeStrings(input?.countries ?? []).map((item) =>
        item.toUpperCase(),
      ),
      ageMin: input?.ageMin ?? null,
      ageMax: input?.ageMax ?? null,
      genders: this.normalizeStrings(input?.genders ?? []),
      interests: this.normalizeStrings(input?.interests ?? []),
      savedAudienceExternalId:
        this.normalizeNullable(input?.savedAudienceExternalId) ?? null,
    };
  }

  private assertAudience(mode: string, audience: SocialBoostAudience) {
    if (
      audience.ageMin !== null &&
      audience.ageMax !== null &&
      audience.ageMin > audience.ageMax
    ) {
      throw new BadRequestException(
        'Audience minimum age cannot exceed maximum age.',
      );
    }

    if (mode === 'saved' && !audience.savedAudienceExternalId) {
      throw new BadRequestException(
        'A saved audience id is required for saved audience mode.',
      );
    }

    if (mode === 'custom' && audience.countries.length === 0) {
      throw new BadRequestException(
        'At least one country is required for a custom audience.',
      );
    }
  }

  private requireText(value: string) {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException('Template name is required.');
    }
    return normalized;
  }

  private normalizeNullable(value: string | null | undefined) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizeStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }
}
