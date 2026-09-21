import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  DASHBOARD_CHANNEL_IDS,
  DashboardLayoutError,
  emptyDashboardLayout,
  parseDashboardLayout,
  type DashboardChannelId,
  type DashboardLayout,
} from './dashboard-layout.contract';
import {
  CreateSocialAnalyticsDashboardDto,
  UpdateSocialAnalyticsDashboardDto,
} from './dto/social-analytics-dashboard.dto';
import { SocialAnalyticsDashboardEntity } from './entities';

/**
 * The id the frontend has been emitting for the built-in dashboard since Etapa
 * 3, before any row existed. Kept as the seeded row's *name* anchor so URLs
 * already in circulation keep resolving — see `resolveDashboardId`.
 */
export const DEFAULT_DASHBOARD_ALIAS = 'overview';
export const DEFAULT_DASHBOARD_NAME = 'Visão Geral';

export type SocialAnalyticsDashboardView = {
  id: string;
  name: string;
  isDefault: boolean;
  channels: DashboardChannelId[];
  layout: DashboardLayout;
  createdAt: string;
  updatedAt: string;
};

const MAX_DASHBOARDS_PER_SCOPE = 40;

@Injectable()
export class SocialAnalyticsDashboardsService {
  constructor(
    @InjectRepository(SocialAnalyticsDashboardEntity, 'agency')
    private readonly dashboards: Repository<SocialAnalyticsDashboardEntity>,
  ) {}

  /**
   * Every dashboard in the scope, with the built-in one guaranteed present.
   *
   * The default is seeded on first read rather than by the migration: its scope
   * is the CC2C quartet, and a migration cannot enumerate company contexts that
   * do not exist yet. Seeding here means the first operator to open Analytics in
   * a new context gets the row, and everybody after them reads it.
   */
  async list(
    scope: CompanyAwareScope,
    actorId: string | null,
  ): Promise<SocialAnalyticsDashboardView[]> {
    await this.ensureDefault(scope, actorId);

    const rows = await this.dashboards.find({
      where: this.where(scope),
      // The built-in one first, then oldest to newest: the tab strip's order is
      // the creation order, so a new dashboard appears at the end rather than
      // displacing the tabs the operator already knows.
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    return rows.map((row) => this.toView(row));
  }

  async create(
    scope: CompanyAwareScope,
    actorId: string | null,
    dto: CreateSocialAnalyticsDashboardDto,
  ): Promise<SocialAnalyticsDashboardView> {
    const name = dto.name.trim();

    if (!name) {
      throw new BadRequestException('Informe um nome para o dashboard.');
    }

    const channels = this.normalizeChannels(dto.channels);

    const total = await this.dashboards.count({ where: this.where(scope) });
    if (total >= MAX_DASHBOARDS_PER_SCOPE) {
      throw new BadRequestException(
        'Este contexto já atingiu o limite de dashboards.',
      );
    }

    const entity = this.dashboards.create({
      ...this.values(scope),
      name,
      isDefault: false,
      channels,
      layout: emptyDashboardLayout(channels),
      createdById: actorId,
    });

    return this.toView(await this.saveUnique(entity));
  }

  /**
   * Partial update.
   *
   * Field by field, never `Object.assign(entity, { ...dto })`: an absent key in
   * a PATCH body means "leave it alone", and spreading the DTO would write
   * `undefined` over the column — the failure recorded in
   * `feedback_dto_spread_undefined_overwrite`.
   */
  async update(
    scope: CompanyAwareScope,
    id: string,
    dto: UpdateSocialAnalyticsDashboardDto,
  ): Promise<SocialAnalyticsDashboardView> {
    const dashboard = await this.find(scope, id);

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      if (!name) {
        throw new BadRequestException('Informe um nome para o dashboard.');
      }

      dashboard.name = name;
    }

    if (dto.channels !== undefined) {
      dashboard.channels = this.normalizeChannels(dto.channels);
    }

    if (dto.layout !== undefined) {
      try {
        dashboard.layout = parseDashboardLayout(dto.layout);
      } catch (error) {
        if (error instanceof DashboardLayoutError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    return this.toView(await this.saveUnique(dashboard));
  }

  async remove(scope: CompanyAwareScope, id: string): Promise<void> {
    const dashboard = await this.find(scope, id);

    // The built-in dashboard is the one every scope is guaranteed to have, and
    // the frontend routes to it whenever no other is selected. Deleting it
    // would strand those URLs, and the next read would seed it straight back.
    if (dashboard.isDefault) {
      throw new BadRequestException(
        'O dashboard "Visão Geral" não pode ser excluído.',
      );
    }

    await this.dashboards.remove(dashboard);
  }

  async find(
    scope: CompanyAwareScope,
    id: string,
  ): Promise<SocialAnalyticsDashboardEntity> {
    const dashboard = await this.dashboards.findOne({
      where: { ...this.where(scope), id },
    });

    if (!dashboard) {
      throw new NotFoundException('Dashboard não encontrado neste contexto.');
    }

    return dashboard;
  }

  /**
   * Creates the built-in dashboard for this scope if it has none.
   *
   * Two operators opening Analytics at the same moment both see no default and
   * both insert. The partial unique index on the normalized name is what makes
   * that safe: the loser gets a unique violation and re-reads instead of
   * creating a second "Visão Geral".
   */
  private async ensureDefault(
    scope: CompanyAwareScope,
    actorId: string | null,
  ): Promise<void> {
    const existing = await this.dashboards.findOne({
      where: { ...this.where(scope), isDefault: true },
    });

    if (existing) return;

    const channels = this.normalizeChannels([...DASHBOARD_CHANNEL_IDS]);

    try {
      // `save`, not `insert`: the layout column is a recursive jsonb type that
      // `insert`'s deep-partial parameter cannot express.
      await this.dashboards.save(
        this.dashboards.create({
          ...this.values(scope),
          name: DEFAULT_DASHBOARD_NAME,
          isDefault: true,
          channels,
          layout: emptyDashboardLayout(channels),
          createdById: actorId,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      // Someone else seeded it between the read and the insert. Nothing to do.
    }
  }

  private async saveUnique(entity: SocialAnalyticsDashboardEntity) {
    try {
      return await this.dashboards.save(entity);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Já existe um dashboard com este nome neste contexto.',
        );
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code === '23505'
    );
  }

  /**
   * Channels in catalog order, not the order they arrived in.
   *
   * The order decides how sections are laid out, so accepting the caller's
   * would make two dashboards with the same channels render differently
   * depending on the order the checkboxes happened to be ticked.
   */
  private normalizeChannels(
    channels: DashboardChannelId[],
  ): DashboardChannelId[] {
    const requested = new Set(channels);
    const normalized = DASHBOARD_CHANNEL_IDS.filter((channel) =>
      requested.has(channel),
    );

    if (normalized.length === 0) {
      throw new BadRequestException('Selecione ao menos um canal.');
    }

    return [...normalized];
  }

  private where(scope: CompanyAwareScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
  }

  private values(scope: CompanyAwareScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
    };
  }

  private toView(
    row: SocialAnalyticsDashboardEntity,
  ): SocialAnalyticsDashboardView {
    return {
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
      channels: row.channels ?? [],
      layout: row.layout ?? emptyDashboardLayout([]),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
