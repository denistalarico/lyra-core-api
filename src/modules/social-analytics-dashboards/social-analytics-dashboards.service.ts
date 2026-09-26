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

/**
 * The channels that get a screen of their own, and what those screens are
 * called.
 *
 * `google_ads` is deliberately absent: the integration does not exist yet, and
 * a seeded tab that can only ever say "not integrated" is a promise the product
 * does not keep. It joins the list when the channel does.
 */
export const SEEDED_CHANNEL_DASHBOARDS: ReadonlyArray<{
  channel: DashboardChannelId;
  name: string;
}> = [
  { channel: 'facebook', name: 'Facebook' },
  { channel: 'instagram', name: 'Instagram' },
  { channel: 'meta_ads', name: 'Meta Ads' },
];

export type SocialAnalyticsDashboardView = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  /**
   * The channel this row is the fixed screen for, or null for an ordinary
   * dashboard. The frontend uses it to lock the name and hide the delete
   * option; it is never derived from `channels`, which an operator can edit.
   */
  channelKey: DashboardChannelId | null;
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
    await this.ensureChannelDashboards(scope, actorId);

    const rows = await this.dashboards.find({
      where: this.where(scope),
      // The built-in one first, then oldest to newest: the tab strip's order is
      // the creation order, so a new dashboard appears at the end rather than
      // displacing the tabs the operator already knows.
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    // Visão Geral, then the channel screens in catalog order, then whatever the
    // operator built. Sorting here rather than in SQL because the channel order
    // is the product's, not the creation order's: seeding runs concurrently in
    // a fresh scope, so two operators opening Analytics at the same moment
    // could otherwise end up looking at differently ordered tabs.
    return rows
      .map((row) => this.toView(row))
      .sort((left, right) => this.tabRank(left) - this.tabRank(right));
  }

  /** Where a dashboard sits in the tab strip. */
  private tabRank(view: SocialAnalyticsDashboardView): number {
    if (view.isDefault) return 0;

    if (view.channelKey) {
      const index = SEEDED_CHANNEL_DASHBOARDS.findIndex(
        (entry) => entry.channel === view.channelKey,
      );
      return index >= 0 ? 1 + index : 1 + SEEDED_CHANNEL_DASHBOARDS.length;
    }

    // Everything the operator made keeps its creation order, after the fixed
    // screens. `find` already returned them sorted, and `sort` is stable.
    return 100;
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

      // A channel screen is identified by its channel, and its name is how the
      // operator finds that channel in the strip. Renaming "Instagram" to
      // something else would leave a tab nobody can place, and the seeder would
      // not create a replacement because the channel is still taken.
      if (dashboard.channelKey && name !== dashboard.name) {
        throw new BadRequestException(
          'O nome de um dashboard de canal não pode ser alterado.',
        );
      }

      dashboard.name = name;
    }

    if (dto.description !== undefined) {
      dashboard.description = dto.description.trim() || null;
    }

    if (dto.channels !== undefined) {
      // Same reasoning: the channel is this row's identity. Its layout is fully
      // editable, its scope is not.
      if (dashboard.channelKey) {
        throw new BadRequestException(
          'Um dashboard de canal não pode mudar de canal.',
        );
      }

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

    // A channel screen would be re-seeded by the next read, so the delete would
    // appear to fail rather than to be refused. Refusing it says what is true.
    if (dashboard.channelKey) {
      throw new BadRequestException(
        'Os dashboards de canal não podem ser excluídos.',
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

  /**
   * Creates the per-channel screens this scope is missing.
   *
   * Read-then-insert per channel, with the unique violation swallowed, for the
   * same reason `ensureDefault` does it: two operators opening Analytics at the
   * same moment both see nothing and both insert, and the partial unique index
   * on `channel_key` is what makes the loser harmless.
   *
   * A channel whose screen was deleted directly in the database is re-seeded on
   * the next read. That is intended — these are fixed screens, and the delete
   * path already refuses to remove them.
   */
  private async ensureChannelDashboards(
    scope: CompanyAwareScope,
    actorId: string | null,
  ): Promise<void> {
    const existing = await this.dashboards.find({
      where: this.where(scope),
      select: ['id', 'channelKey'],
    });
    const seeded = new Set(
      existing.flatMap((row) => (row.channelKey ? [row.channelKey] : [])),
    );

    for (const entry of SEEDED_CHANNEL_DASHBOARDS) {
      if (seeded.has(entry.channel)) continue;

      try {
        await this.dashboards.save(
          this.dashboards.create({
            ...this.values(scope),
            name: entry.name,
            isDefault: false,
            channelKey: entry.channel,
            channels: [entry.channel],
            layout: emptyDashboardLayout([entry.channel]),
            createdById: actorId,
          }),
        );
      } catch (error) {
        // Either another request seeded it first, or the scope already holds an
        // operator-made dashboard with this name. Both are unique violations and
        // neither is worth failing the whole list over — the operator keeps the
        // dashboard they named, and the channel screen is simply not offered.
        if (!this.isUniqueViolation(error)) throw error;
      }
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
      description: row.description ?? null,
      isDefault: row.isDefault,
      channelKey: row.channelKey ?? null,
      channels: row.channels ?? [],
      layout: row.layout ?? emptyDashboardLayout([]),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
