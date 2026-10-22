import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import {
  ClientAreaCompanyHooksRegistry,
  type ClientAreaCompanyScope,
} from '../client-area/client-area-company-hooks.registry';
import { isUuid } from '../client-area/client-area.types';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { toCompanyAwareScope } from '../client-area/client-area-scope';
import { ClientAreaDashboardEntity } from './client-area-dashboard.entity';
import {
  cardMetricIds,
  CLIENT_AREA_METRICS,
  CLIENT_AREA_SECTIONS,
  defaultClientAreaLayout,
  metricAvailable,
  metricById,
  parseClientAreaLayout,
  type ClientAreaCard,
} from './client-area-layout.contract';
export type DashboardActor =
  | { surface: 'agency'; userId: string }
  | { surface: 'client_area'; context: ClientAreaContext };
export type DashboardInput = { name?: string; layout?: unknown };
/** D-19 private arrangements, isolated by full company scope and author on every lookup. */
@Injectable()
export class ClientAreaDashboardsService implements OnModuleInit {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly hooks: ClientAreaCompanyHooksRegistry,
    private readonly products: CompanyProductRegistry,
  ) {}
  onModuleInit() {
    this.hooks.register('ca13-dashboards', (scope, manager) =>
      this.seed(scope, manager),
    );
    for (const productKey of ['leadflow', 'social'] as const)
      this.products.register({
        key: `ca13-${productKey}-dashboards`,
        productKey,
        pending: () => Promise.resolve([]),
        activate: async (op) => {
          await this.seed(op.scope, op.manager, {
            product: productKey,
            active: true,
          });
          return null;
        },
        remove: (op) =>
          this.seed(op.scope, op.manager, {
            product: productKey,
            active: false,
          }),
      });
  }
  async assertCompany(scope: ClientAreaCompanyScope) {
    return this.assertScope(scope, this.db.manager);
  }
  private async assertScope(
    scope: ClientAreaCompanyScope,
    manager: EntityManager,
  ) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT cc.id FROM agency_client_company_contexts cc JOIN agency_clients c ON c.id=cc.agency_client_id AND c.tenant_id=cc.tenant_id AND c.workspace_id=cc.workspace_id WHERE cc.tenant_id=$1 AND cc.workspace_id=$2 AND cc.agency_client_id=$3 AND cc.id=$4 AND cc.status='active' AND cc.archived_at IS NULL AND c.status='active' AND c.archived_at IS NULL`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    if (!rows.length) throw new NotFoundException('Company not found.');
  }
  private async companyExists(
    scope: ClientAreaCompanyScope,
    manager: EntityManager,
  ) {
    const rows = await manager.query<{ id: string }[]>(
      'SELECT id FROM agency_client_company_contexts WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND id=$4',
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    return rows.length > 0;
  }
  private assertActor(scope: ClientAreaCompanyScope, actor: DashboardActor) {
    if (actor.surface === 'agency') return;
    const current = toCompanyAwareScope(actor.context);
    if (Object.keys(current).some((key) => current[key] !== scope[key]))
      throw new NotFoundException();
    if (
      !actor.context.memberAccess?.analytics?.available ||
      !actor.context.memberAccess.analytics.level
    )
      throw new ForbiddenException({ code: 'client_area_module_unavailable' });
  }
  private async lock(scope: ClientAreaCompanyScope, manager: EntityManager) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [
        `ca13:${scope.tenantId}:${scope.workspaceId}:${scope.agencyClientId}:${scope.companyContextId}`,
      ],
    );
  }
  async seed(
    scope: ClientAreaCompanyScope,
    manager: EntityManager,
    change?: { product: string; active: boolean },
    force = false,
  ) {
    await this.lock(scope, manager);
    // Product lifecycle runs for any client status (offboarded, paused…) and
    // inside archival; only Client Area reads require an active client.
    if (!change) await this.assertScope(scope, manager);
    else if (!(await this.companyExists(scope, manager))) return;
    const settings = await manager.query<{ enabled: boolean }[]>(
      'SELECT enabled FROM client_area_company_settings WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND company_context_id=$4',
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    if (!force && !settings[0]?.enabled) return;
    const rows = await manager.query<{ product_key: string }[]>(
      "SELECT product_key FROM agency_client_company_products WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND company_context_id=$4 AND status='active'",
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    const active = new Set(rows.map((p) => p.product_key));
    if (change) {
      if (change.active) active.add(change.product);
      else active.delete(change.product);
    }
    const repo = manager.getRepository(ClientAreaDashboardEntity);
    const current = await repo.findOne({
      where: { ...scope, isDefault: true },
    });
    if (!current) {
      await repo.save(
        repo.create({
          ...scope,
          ownerSurface: 'agency',
          ownerUserId: null,
          isDefault: true,
          name: 'Visão Geral',
          layout: defaultClientAreaLayout([...active]),
        }),
      );
      return;
    }
    if (!change) return;
    // Only visibility and genuinely new product sections change; titles/cards/order survive.
    const layout = structuredClone(current.layout);
    for (const section of layout.sections)
      if (section.channel.startsWith(`${change.product}.`))
        section.hidden = !change.active;
    if (
      change.active &&
      !layout.sections.some((s) => s.channel.startsWith(`${change.product}.`))
    )
      layout.sections.push(
        ...defaultClientAreaLayout([change.product]).sections.filter((s) =>
          s.channel.startsWith(`${change.product}.`),
        ),
      );
    current.layout = layout;
    await repo.save(current);
  }
  private visibleWhere(scope: ClientAreaCompanyScope, actor: DashboardActor) {
    const agency = {
      ...scope,
      ownerSurface: 'agency' as const,
      ownerUserId: IsNull(),
    };
    return actor.surface === 'agency'
      ? [agency]
      : [
          agency,
          {
            ...scope,
            ownerSurface: 'client_area' as const,
            ownerUserId: actor.context.userId,
          },
        ];
  }
  private async find(
    scope: ClientAreaCompanyScope,
    actor: DashboardActor,
    id: string,
    manager: EntityManager,
  ) {
    const where = this.visibleWhere(scope, actor).map((filter) => ({
      ...filter,
      ...(id === 'overview' ? { isDefault: true } : { id }),
    }));
    if (id !== 'overview' && !isUuid(id)) throw new NotFoundException();
    const row = await manager
      .getRepository(ClientAreaDashboardEntity)
      .findOne({ where });
    if (!row) throw new NotFoundException('Dashboard not found.');
    return row;
  }
  private editable(row: ClientAreaDashboardEntity, actor: DashboardActor) {
    if (actor.surface === 'client_area' && row.ownerSurface === 'agency')
      throw new ForbiddenException({
        code: 'client_area_dashboard_agency_owned',
        message: 'O dashboard pertence à agência.',
      });
  }
  private layout(input: unknown, actor: DashboardActor) {
    const layout = parseClientAreaLayout(input);
    if (
      actor.surface === 'client_area' &&
      layout.sections
        .flatMap((s) => s.cards)
        .flatMap(cardMetricIds)
        .some((id) => !metricAvailable(actor.context, metricById(id)!))
    )
      throw new ForbiddenException({
        code: 'client_area_dashboard_card_unavailable',
      });
    return layout;
  }
  private name(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
      throw new BadRequestException('Nome inválido.');
    return value.trim();
  }
  private view(row: ClientAreaDashboardEntity, actor: DashboardActor) {
    const availability: Record<
      string,
      { status: 'available' | 'unavailable'; reason?: string }
    > = {};
    const visit = (card: ClientAreaCard) => {
      const available =
        actor.surface === 'agency' ||
        cardMetricIds(card).every((id) => {
          const metric = metricById(id);
          return metric && metricAvailable(actor.context, metric);
        });
      availability[card.id] = available
        ? { status: 'available' }
        : { status: 'unavailable', reason: 'module_unavailable' };
      if (card.kind === 'group')
        (card.cards as ClientAreaCard[]).forEach(visit);
    };
    row.layout.sections.forEach((s) => s.cards.forEach(visit));
    return {
      id: row.id,
      name: row.name,
      ownerSurface: row.ownerSurface,
      isDefault: row.isDefault,
      layout: row.layout,
      cardAvailability: availability,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async list(scope: ClientAreaCompanyScope, actor: DashboardActor) {
    this.assertActor(scope, actor);
    await this.db.transaction((manager) =>
      this.seed(scope, manager, undefined, true),
    );
    const rows = await this.db.getRepository(ClientAreaDashboardEntity).find({
      where: this.visibleWhere(scope, actor),
      order: { isDefault: 'DESC', createdAt: 'ASC', id: 'ASC' },
    });
    const catalog = CLIENT_AREA_METRICS.filter(
      (m) => actor.surface === 'agency' || metricAvailable(actor.context, m),
    );
    return {
      items: rows.map((row) => this.view(row, actor)),
      total: rows.length,
      catalog,
      sections: CLIENT_AREA_SECTIONS,
    };
  }
  async read(scope: ClientAreaCompanyScope, actor: DashboardActor, id: string) {
    this.assertActor(scope, actor);
    await this.assertScope(scope, this.db.manager);
    return this.view(await this.find(scope, actor, id, this.db.manager), actor);
  }
  async create(
    scope: ClientAreaCompanyScope,
    actor: DashboardActor,
    input: DashboardInput,
  ) {
    this.assertActor(scope, actor);
    const name = this.name(input.name);
    const layout = this.layout(
      input.layout ?? { version: 1, sections: [] },
      actor,
    );
    return this.db.transaction(async (manager) => {
      await this.lock(scope, manager);
      await this.assertScope(scope, manager);
      const repo = manager.getRepository(ClientAreaDashboardEntity);
      const where =
        actor.surface === 'agency'
          ? { ...scope, ownerSurface: 'agency' as const }
          : {
              ...scope,
              ownerSurface: 'client_area' as const,
              ownerUserId: actor.context.userId,
            };
      if ((await repo.count({ where })) >= 40)
        throw new BadRequestException('Limite de dashboards atingido.');
      return this.view(
        await repo.save(
          repo.create({
            ...scope,
            ownerSurface: actor.surface,
            ownerUserId:
              actor.surface === 'agency' ? null : actor.context.userId,
            isDefault: false,
            name,
            layout,
          }),
        ),
        actor,
      );
    });
  }
  async update(
    scope: ClientAreaCompanyScope,
    actor: DashboardActor,
    id: string,
    input: DashboardInput,
  ) {
    this.assertActor(scope, actor);
    return this.db.transaction(async (manager) => {
      await this.lock(scope, manager);
      await this.assertScope(scope, manager);
      const row = await this.find(scope, actor, id, manager);
      this.editable(row, actor);
      if (input.name !== undefined) row.name = this.name(input.name);
      if (input.layout !== undefined)
        row.layout = this.layout(input.layout, actor);
      return this.view(
        await manager.getRepository(ClientAreaDashboardEntity).save(row),
        actor,
      );
    });
  }
  async remove(
    scope: ClientAreaCompanyScope,
    actor: DashboardActor,
    id: string,
  ) {
    this.assertActor(scope, actor);
    await this.db.transaction(async (manager) => {
      await this.lock(scope, manager);
      await this.assertScope(scope, manager);
      const row = await this.find(scope, actor, id, manager);
      this.editable(row, actor);
      if (row.isDefault)
        throw new BadRequestException(
          'O dashboard padrão não pode ser excluído.',
        );
      await manager.getRepository(ClientAreaDashboardEntity).remove(row);
    });
  }
  async duplicate(
    scope: ClientAreaCompanyScope,
    actor: DashboardActor,
    id: string,
    input: DashboardInput,
  ) {
    const source = await this.read(scope, actor, id);
    const layout = structuredClone(source.layout);
    if (actor.surface === 'client_area') {
      const filter = (cards: ClientAreaCard[]): ClientAreaCard[] =>
        cards.flatMap((card) =>
          card.kind === 'group'
            ? [{ ...card, cards: filter(card.cards as ClientAreaCard[]) }]
            : cardMetricIds(card).every((id) =>
                  metricAvailable(actor.context, metricById(id)!),
                )
              ? [card]
              : [],
        );
      layout.sections = layout.sections.map((s) => ({
        ...s,
        cards: filter(s.cards),
      }));
    }
    return this.create(scope, actor, {
      name: input.name ?? `${source.name.slice(0, 112)} (cópia)`,
      layout,
    });
  }
}
