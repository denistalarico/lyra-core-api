import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  LEADFLOW_ANALYTICS_CHART_IDS,
  LEADFLOW_ANALYTICS_CHART_MODES,
  LEADFLOW_ANALYTICS_SUMMARY_TYPES,
  LEADFLOW_ANALYTICS_WIDGET_IDS,
  type LeadFlowAnalyticsChartMode,
  type LeadFlowAnalyticsSummaryType,
  type UpsertAnalyticsViewDto,
} from '../dto/upsert-analytics-view.dto';
import { LeadFlowAnalyticsViewEntity } from '../entities/leadflow-analytics-view.entity';

const AGENCY_CONNECTION = 'agency';
const ANALYTICS_VIEW_SCHEMA_VERSION = 2;
const MAX_ANALYTICS_VIEWS_PER_SCOPE = 20;
const analyticsWidgetIds = new Set<string>(LEADFLOW_ANALYTICS_WIDGET_IDS);
const analyticsSummaryTypes = new Set<string>(LEADFLOW_ANALYTICS_SUMMARY_TYPES);
const analyticsChartIds = new Set<string>(LEADFLOW_ANALYTICS_CHART_IDS);
const analyticsChartModes = new Set<string>(LEADFLOW_ANALYTICS_CHART_MODES);
const applicableChartModes: Record<string, Set<string>> = {
  commercial_stages: new Set(['horizontal_bar', 'vertical_bar']),
  commercial_handoff: new Set([
    'horizontal_bar',
    'vertical_bar',
    'line',
    'area',
  ]),
  message_channels: new Set(['horizontal_bar', 'vertical_bar']),
  agent_performance: new Set(['horizontal_bar', 'vertical_bar', 'pie']),
  lead_score_distribution: new Set(['horizontal_bar', 'vertical_bar', 'pie']),
  automation_outcomes: new Set(['horizontal_bar', 'vertical_bar']),
};

type AnalyticsViewScope = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
};

@Injectable()
export class LeadFlowAnalyticsViewsService {
  constructor(
    @InjectRepository(LeadFlowAnalyticsViewEntity, AGENCY_CONNECTION)
    private readonly views: Repository<LeadFlowAnalyticsViewEntity>,
  ) {}

  async list(ctx: RequestContext) {
    const scope = this.resolveScope(ctx);
    return this.views.find({
      where: this.scopeWhere(scope),
      order: { updatedAt: 'DESC', id: 'ASC' },
      take: MAX_ANALYTICS_VIEWS_PER_SCOPE,
    });
  }

  async create(ctx: RequestContext, dto: UpsertAnalyticsViewDto) {
    const scope = this.resolveScope(ctx);
    const value = this.sanitize(dto);
    const duplicate = await this.views
      .createQueryBuilder('view')
      .where('view.tenant_id = :tenantId', scope)
      .andWhere('view.workspace_id = :workspaceId', scope)
      .andWhere('view.user_id = :userId', scope)
      .andWhere('view.context_type = :contextType', scope)
      .andWhere(
        scope.agencyClientId
          ? 'view.agency_client_id = :agencyClientId'
          : 'view.agency_client_id IS NULL',
        scope,
      )
      .andWhere('LOWER(view.name) = LOWER(:name)', { name: value.name })
      .getOne();
    if (duplicate) {
      throw new ConflictException('Já existe uma visão com este nome.');
    }

    const count = await this.views.count({ where: this.scopeWhere(scope) });
    if (count >= MAX_ANALYTICS_VIEWS_PER_SCOPE) {
      throw new ConflictException(
        `Limite de ${MAX_ANALYTICS_VIEWS_PER_SCOPE} visões salvas por contexto atingido.`,
      );
    }
    if (value.isDefault) {
      await this.views.update(this.scopeWhere(scope), { isDefault: false });
    }
    return this.views.save(
      this.views.create({
        ...scope,
        ...value,
        schemaVersion: ANALYTICS_VIEW_SCHEMA_VERSION,
      }),
    );
  }

  async update(ctx: RequestContext, id: string, dto: UpsertAnalyticsViewDto) {
    const scope = this.resolveScope(ctx);
    const view = await this.views.findOne({
      where: { id, ...this.scopeWhere(scope) },
    });
    if (!view) {
      throw new NotFoundException('Visão salva não encontrada neste contexto.');
    }
    const value = this.sanitize(dto);
    const duplicate = await this.views
      .createQueryBuilder('view')
      .where('view.tenant_id = :tenantId', scope)
      .andWhere('view.workspace_id = :workspaceId', scope)
      .andWhere('view.user_id = :userId', scope)
      .andWhere('view.context_type = :contextType', scope)
      .andWhere(
        scope.agencyClientId
          ? 'view.agency_client_id = :agencyClientId'
          : 'view.agency_client_id IS NULL',
        scope,
      )
      .andWhere('LOWER(view.name) = LOWER(:name)', { name: value.name })
      .andWhere('view.id <> :id', { id })
      .getOne();
    if (duplicate) {
      throw new ConflictException('Já existe uma visão com este nome.');
    }
    Object.assign(view, value, {
      widgetOrder:
        dto.widgetOrder === undefined ? view.widgetOrder : value.widgetOrder,
      hiddenWidgetIds:
        dto.hiddenWidgetIds === undefined
          ? view.hiddenWidgetIds
          : value.hiddenWidgetIds,
      summaryTypes:
        dto.summaryTypes === undefined ? view.summaryTypes : value.summaryTypes,
      chartModes:
        dto.chartModes === undefined ? view.chartModes : value.chartModes,
      schemaVersion: ANALYTICS_VIEW_SCHEMA_VERSION,
    });
    if (value.isDefault) {
      await this.views.update(this.scopeWhere(scope), { isDefault: false });
    }
    return this.views.save(view);
  }

  async remove(ctx: RequestContext, id: string) {
    const scope = this.resolveScope(ctx);
    const result = await this.views.delete({ id, ...this.scopeWhere(scope) });
    if (!result.affected) {
      throw new NotFoundException('Visão salva não encontrada neste contexto.');
    }
  }

  private resolveScope(ctx: RequestContext): AnalyticsViewScope {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Tenant, workspace and user context are required.',
      );
    }
    const agencyClientId =
      ctx.managedContext?.operatingMode === 'client'
        ? ctx.managedContext.clientId
        : null;
    if (ctx.managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Managed client context is required.');
    }
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      contextType: agencyClientId
        ? LeadFlowSettingsContextType.Client
        : LeadFlowSettingsContextType.Agency,
      agencyClientId,
    };
  }

  private scopeWhere(scope: AnalyticsViewScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      contextType: scope.contextType,
      agencyClientId: scope.agencyClientId ?? IsNull(),
    };
  }

  private sanitize(dto: UpsertAnalyticsViewDto) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('O nome da visão é obrigatório.');
    }
    if (dto.from > dto.to) {
      throw new BadRequestException('O período da visão é inválido.');
    }
    const widgetOrder = this.sanitizeWidgetIds(dto.widgetOrder, 'ordem');
    const hiddenWidgetIds = this.sanitizeWidgetIds(
      dto.hiddenWidgetIds,
      'visibilidade',
    );
    const summaryTypes = this.sanitizeSummaryTypes(
      dto.summaryTypes,
      dto.reportType,
    );
    const chartModes = this.sanitizeChartModes(dto.chartModes);
    return {
      name,
      reportType: dto.reportType,
      from: dto.from,
      to: dto.to,
      channelId: dto.channelId ?? null,
      businessMode: dto.businessMode?.trim() || null,
      agentId: dto.agentId ?? null,
      widgetOrder,
      hiddenWidgetIds,
      summaryTypes,
      chartModes,
      isDefault: dto.isDefault ?? false,
    };
  }

  private sanitizeSummaryTypes(
    value: unknown,
    reportType: UpsertAnalyticsViewDto['reportType'],
  ): LeadFlowAnalyticsSummaryType[] {
    if (value === undefined) {
      if (reportType === 'messages') return ['service'];
      if (reportType === 'commercial') return ['commercial'];
      if (reportType === 'automations') return ['automation'];
      return ['executive'];
    }
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('Escolha pelo menos um resumo da visão.');
    }
    const types = value.filter(
      (item): item is LeadFlowAnalyticsSummaryType => typeof item === 'string',
    );
    if (
      types.length !== value.length ||
      new Set(types).size !== types.length ||
      types.some((type) => !analyticsSummaryTypes.has(type))
    ) {
      throw new BadRequestException(
        'Os resumos informados não são permitidos.',
      );
    }
    return types;
  }

  private sanitizeChartModes(
    value: unknown,
  ): Record<string, LeadFlowAnalyticsChartMode> {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(
        'As visualizações dos gráficos são inválidas.',
      );
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (
      entries.some(
        ([chartId, mode]) =>
          !analyticsChartIds.has(chartId) ||
          typeof mode !== 'string' ||
          !analyticsChartModes.has(mode) ||
          !applicableChartModes[chartId]?.has(mode),
      )
    ) {
      throw new BadRequestException(
        'Uma visualização de gráfico informada não é permitida.',
      );
    }
    return Object.fromEntries(entries) as Record<
      string,
      LeadFlowAnalyticsChartMode
    >;
  }

  private sanitizeWidgetIds(value: unknown, field: string) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException(`A ${field} dos widgets é inválida.`);
    }
    const ids = value.filter(
      (item): item is string => typeof item === 'string',
    );
    if (ids.length !== value.length || new Set(ids).size !== ids.length) {
      throw new BadRequestException(`A ${field} dos widgets é inválida.`);
    }
    if (ids.some((id) => !analyticsWidgetIds.has(id))) {
      throw new BadRequestException(
        'O catálogo de widgets informado não é permitido.',
      );
    }
    return ids;
  }
}
