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
import type { UpsertAnalyticsViewDto } from '../dto/upsert-analytics-view.dto';
import { LeadFlowAnalyticsViewEntity } from '../entities/leadflow-analytics-view.entity';

const AGENCY_CONNECTION = 'agency';
const ANALYTICS_VIEW_SCHEMA_VERSION = 1;
const MAX_ANALYTICS_VIEWS_PER_SCOPE = 20;

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
      schemaVersion: ANALYTICS_VIEW_SCHEMA_VERSION,
    });
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
    return {
      name,
      reportType: dto.reportType,
      from: dto.from,
      to: dto.to,
      channelId: dto.channelId ?? null,
      businessMode: dto.businessMode?.trim() || null,
      agentId: dto.agentId ?? null,
    };
  }
}
