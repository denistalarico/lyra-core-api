import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import { isActiveProductEntitlement } from '../../../common/context/product-entitlement-availability';
import {
  AgencyActivity,
  AgencyActivityLink,
} from '../../activities/entities';
import { ActivityEntityType, ActivityStatus } from '../../activities/enums';
import { AgencyProject, AgencyTask } from '../../projects/entities';
import { ProjectStatus, TaskStatus } from '../../projects/enums';
import {
  CreateClientDto,
  ListClientsQueryDto,
  UpdateClientDto,
  UpdateClientProductDto,
} from '../dto';
import { AgencyClient, ClientLifecycleProcess } from '../entities';
import {
  AgencyClientLifecycleStage,
  AgencyClientStatus,
  ClientLifecycleProcessStatus,
} from '../enums';
import { ClientCostCenterService } from './client-cost-center.service';
import { ClientNotificationPublisher } from './client-notification.publisher';
import { ClientsProfitabilityService } from './clients-profitability.service';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import {
  PlatformProductKey,
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from '../../platform/enums/platform-product.enums';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

const AGENCY_CONNECTION = 'agency';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MANAGEABLE_CLIENT_PRODUCTS = [
  PlatformProductKey.LeadFlow,
  PlatformProductKey.Social,
] as const;

type ManageableClientProductKey = (typeof MANAGEABLE_CLIENT_PRODUCTS)[number];

export type ClientProductSummary = {
  productKey: ManageableClientProductKey;
  status: ProductEntitlementStatus | 'not_configured';
  available: boolean;
  planKey: string | null;
  startsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
};

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
    @InjectRepository(ClientLifecycleProcess, AGENCY_CONNECTION)
    private readonly lifecycleProcessesRepository: Repository<ClientLifecycleProcess>,
    @InjectRepository(AgencyProject, AGENCY_CONNECTION)
    private readonly projectsRepository: Repository<AgencyProject>,
    @InjectRepository(AgencyTask, AGENCY_CONNECTION)
    private readonly tasksRepository: Repository<AgencyTask>,
    @InjectRepository(AgencyActivity, AGENCY_CONNECTION)
    private readonly activitiesRepository: Repository<AgencyActivity>,
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    private readonly clientsProfitabilityService: ClientsProfitabilityService,
    private readonly clientNotificationPublisher: ClientNotificationPublisher,
    private readonly clientCostCenterService: ClientCostCenterService,
  ) {}

  async list(context: RequestContext, query: ListClientsQueryDto) {
    const limit = this.parseLimit(query.limit);
    const offset = this.parseOffset(query.offset);

    const qb = this.clientsRepository
      .createQueryBuilder('client')
      .where('client.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('client.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      });

    if (query.includeArchived !== 'true') {
      qb.andWhere('client.archived_at IS NULL');
    }

    if (query.q) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('client.display_name ILIKE :q', { q: `%${query.q}%` })
            .orWhere('client.legal_name ILIKE :q', { q: `%${query.q}%` })
            .orWhere('client.segment ILIKE :q', { q: `%${query.q}%` });
        }),
      );
    }

    if (query.status) {
      qb.andWhere('client.status = :status', { status: query.status });
    }

    if (query.lifecycleStage) {
      qb.andWhere('client.lifecycle_stage = :lifecycleStage', {
        lifecycleStage: query.lifecycleStage,
      });
    }

    if (query.healthStatus) {
      qb.andWhere('client.health_status = :healthStatus', {
        healthStatus: query.healthStatus,
      });
    }

    if (query.segment) {
      qb.andWhere('client.segment = :segment', { segment: query.segment });
    }

    if (query.accountOwnerId) {
      qb.andWhere('client.account_owner_id = :accountOwnerId', {
        accountOwnerId: query.accountOwnerId,
      });
    }

    const [items, total] = await qb
      .orderBy('client.display_name', 'ASC')
      .take(limit)
      .skip(offset)
      .getManyAndCount();

    const productsByClientId = await this.loadProductsForClients(items);

    const clientIds = items.map((client) => client.id);
    const lifecycleProcesses =
      clientIds.length > 0
        ? await this.lifecycleProcessesRepository.find({
            where: {
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              clientId: In(clientIds),
              status: ClientLifecycleProcessStatus.InProgress,
            },
            order: { startedAt: 'DESC', createdAt: 'DESC' },
          })
        : [];
    const processesByClient = new Map<
      string,
      Array<{
        id: string;
        processType: ClientLifecycleProcess['processType'];
        status: ClientLifecycleProcess['status'];
        startedAt: Date | null;
      }>
    >();

    for (const process of lifecycleProcesses) {
      const clientProcesses = processesByClient.get(process.clientId) ?? [];
      clientProcesses.push({
        id: process.id,
        processType: process.processType,
        status: process.status,
        startedAt: process.startedAt,
      });
      processesByClient.set(process.clientId, clientProcesses);
    }

    return {
      items: items.map((client) => ({
        ...client,
        productsProvisioned: Boolean(client.managedTenantId),
        products: productsByClientId.get(client.id) ?? this.emptyProductSummaries(),
        activeLifecycleProcesses: processesByClient.get(client.id) ?? [],
      })),
      total,
      limit,
      offset,
    };
  }

  async summary(context: RequestContext) {
    const [statusRows, lifecycleRows, healthRows, total, archived, processes] =
      await Promise.all([
        this.countGrouped(context, 'status'),
        this.countGrouped(context, 'lifecycle_stage'),
        this.countGrouped(context, 'health_status'),
        this.clientsRepository.count({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
          },
        }),
        this.clientsRepository
          .createQueryBuilder('client')
          .where('client.tenant_id = :tenantId', {
            tenantId: context.tenantId,
          })
          .andWhere('client.workspace_id = :workspaceId', {
            workspaceId: context.workspaceId,
          })
          .andWhere('client.archived_at IS NOT NULL')
          .getCount(),
        this.lifecycleProcessesRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            status: ClientLifecycleProcessStatus.InProgress,
          },
          order: {
            startedAt: 'DESC',
            createdAt: 'DESC',
          },
        }),
      ]);
    const processClientIds = Array.from(
      new Set(processes.map((process) => process.clientId)),
    );
    const processClients =
      processClientIds.length > 0
        ? await this.clientsRepository.find({
            where: {
              tenantId: context.tenantId,
              workspaceId: context.workspaceId,
              id: In(processClientIds),
              archivedAt: IsNull(),
            },
          })
        : [];
    const processClientById = new Map(
      processClients.map((client) => [client.id, client]),
    );

    return {
      total,
      active: total - archived,
      archived,
      byStatus: this.rowsToCountMap(statusRows),
      byLifecycleStage: this.rowsToCountMap(lifecycleRows),
      byHealthStatus: this.rowsToCountMap(healthRows),
      lifecycleProcesses: processes.flatMap((process) => {
        const client = processClientById.get(process.clientId);

        if (!client) {
          return [];
        }

        return [
          {
            id: process.id,
            clientId: process.clientId,
            clientName: client.displayName,
            processType: process.processType,
            status: ClientLifecycleProcessStatus.InProgress as const,
            startedAt: process.startedAt?.toISOString() ?? null,
            href: `/clients/${process.clientId}?tab=lifecycle&process=${process.processType}`,
          },
        ];
      }),
    };
  }

  async create(context: RequestContext, dto: CreateClientDto) {
    const client = this.clientsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      contactId: dto.contactId ?? null,
      displayName: dto.displayName,
      legalName: dto.legalName ?? null,
      status: dto.status ?? AgencyClientStatus.Active,
      lifecycleStage: dto.lifecycleStage,
      healthStatus: dto.healthStatus,
      segment: dto.segment ?? null,
      accountOwnerId: dto.accountOwnerId ?? null,
      managedTenantId: dto.managedTenantId ?? null,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      notes: dto.notes ?? null,
      metadata: dto.metadata ?? null,
      archivedAt: null,
    });

    const saved = await this.clientsRepository.save(client);

    // Auto-provision a dedicated cost center so quotes/invoices using the
    // `use_client_cost_center` strategy can resolve it. Best-effort and
    // idempotent: a failure here never blocks client creation.
    await this.clientCostCenterService.ensureForClientSafe(context, saved);

    if (saved.accountOwnerId) {
      await this.clientNotificationPublisher.publishAssigned({
        client: saved,
        actorUserId: context.userId,
      });
    }

    return saved;
  }

  async ensureCostCenter(context: RequestContext, clientId: string) {
    const client = await this.findOne(context, clientId);
    return this.clientCostCenterService.ensureForClient(context, client);
  }

  async getCostCenter(context: RequestContext, clientId: string) {
    await this.findOne(context, clientId);
    const costCenter = await this.clientCostCenterService.findLinkedCostCenter(
      context,
      clientId,
    );
    return { costCenter };
  }

  syncCostCenters(context: RequestContext) {
    return this.clientCostCenterService.syncAll(context);
  }

  async findOne(context: RequestContext, clientId: string) {
    const client = await this.clientsRepository.findOne({
      where: {
        id: clientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!client || client.archivedAt) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  async findOneWithProducts(context: RequestContext, clientId: string) {
    const client = await this.findOne(context, clientId);
    const productsByClientId = await this.loadProductsForClients([client]);

    return {
      ...client,
      productsProvisioned: Boolean(client.managedTenantId),
      products: productsByClientId.get(client.id) ?? this.emptyProductSummaries(),
    };
  }

  async updateProduct(
    context: RequestContext,
    clientId: string,
    productKey: string,
    dto: UpdateClientProductDto,
  ): Promise<ClientProductSummary> {
    const client = await this.findOne(context, clientId);
    const manageableProductKey = this.assertManageableProductKey(productKey);

    if (!client.managedTenantId) {
      throw new BadRequestException(
        'Client products cannot be changed until the managed tenant is provisioned',
      );
    }

    let entitlement = await this.entitlementsRepository.findOne({
      where: {
        tenantId: client.managedTenantId,
        productKey: manageableProductKey,
      },
    });

    if (dto.action === 'suspend') {
      if (!entitlement) {
        throw new BadRequestException('Product entitlement is not configured');
      }
      entitlement.status = ProductEntitlementStatus.Suspended;
    } else if (entitlement) {
      // Reactivation reuses the unique tenant/product row. Plan, source,
      // settings, startsAt and trial history stay intact. A still-valid
      // contractual end is also preserved; only an already-ended window,
      // which would keep the new "active" status unavailable, is cleared.
      const now = new Date();
      entitlement.status = ProductEntitlementStatus.Active;
      if (entitlement.endsAt && entitlement.endsAt <= now) {
        entitlement.endsAt = null;
      }
    } else {
      entitlement = this.entitlementsRepository.create({
        tenantId: client.managedTenantId,
        productKey: manageableProductKey,
        status: ProductEntitlementStatus.Active,
        source: ProductEntitlementSource.Manual,
        planKey: null,
        startsAt: new Date(),
        endsAt: null,
        trialEndsAt: null,
        settings: {},
      });
    }

    const saved = await this.entitlementsRepository.save(entitlement);
    return this.toProductSummary(manageableProductKey, saved);
  }

  async update(context: RequestContext, clientId: string, dto: UpdateClientDto) {
    const client = await this.findOne(context, clientId);
    const previousOwnerId = client.accountOwnerId;
    const previousManagedTenantId = client.managedTenantId;
    const previousLifecycleStage = client.lifecycleStage;

    if (dto.contactId !== undefined) client.contactId = dto.contactId;
    if (dto.displayName !== undefined) client.displayName = dto.displayName;
    if (dto.legalName !== undefined) client.legalName = dto.legalName;
    if (dto.status !== undefined) client.status = dto.status;
    if (dto.lifecycleStage !== undefined) client.lifecycleStage = dto.lifecycleStage;
    if (dto.healthStatus !== undefined) client.healthStatus = dto.healthStatus;
    if (dto.segment !== undefined) client.segment = dto.segment;
    if (dto.accountOwnerId !== undefined) client.accountOwnerId = dto.accountOwnerId;
    if (dto.managedTenantId !== undefined) client.managedTenantId = dto.managedTenantId;
    if (dto.startDate !== undefined) client.startDate = dto.startDate;
    if (dto.endDate !== undefined) client.endDate = dto.endDate;
    if (dto.notes !== undefined) client.notes = dto.notes;
    if (dto.metadata !== undefined) client.metadata = dto.metadata;

    if (client.status === AgencyClientStatus.Archived && !client.archivedAt) {
      client.archivedAt = new Date();
    }

    const saved = await this.clientsRepository.save(client);
    const actorUserId = context.userId;

    if (saved.accountOwnerId && saved.accountOwnerId !== previousOwnerId) {
      if (!previousOwnerId) {
        await this.clientNotificationPublisher.publishAssigned({
          client: saved,
          actorUserId,
        });
      } else {
        await this.clientNotificationPublisher.publishOwnerChanged({
          client: saved,
          actorUserId,
          previousOwnerId,
        });
      }
    }

    if (saved.managedTenantId !== previousManagedTenantId) {
      if (!previousManagedTenantId && saved.managedTenantId) {
        await this.clientNotificationPublisher.publishManagedTenantConnected({
          client: saved,
          actorUserId,
        });
      } else if (previousManagedTenantId && !saved.managedTenantId) {
        await this.clientNotificationPublisher.publishManagedTenantDisconnected({
          client: saved,
          actorUserId,
          previousManagedTenantId,
        });
      }
    }

    if (saved.lifecycleStage !== previousLifecycleStage) {
      if (saved.lifecycleStage === AgencyClientLifecycleStage.Onboarding) {
        await this.clientNotificationPublisher.publishOnboardingStarted({
          client: saved,
          actorUserId,
        });
      } else if (previousLifecycleStage === AgencyClientLifecycleStage.Onboarding) {
        await this.clientNotificationPublisher.publishOnboardingCompleted({
          client: saved,
          actorUserId,
        });
      }
    }

    return saved;
  }

  async archive(context: RequestContext, clientId: string) {
    const client = await this.findOne(context, clientId);

    client.status = AgencyClientStatus.Archived;
    client.archivedAt = new Date();

    return this.clientsRepository.save(client);
  }

  async unarchive(context: RequestContext, clientId: string) {
    const client = await this.findAny(context, clientId);

    if (client.status !== AgencyClientStatus.Archived) {
      return client;
    }

    client.status = AgencyClientStatus.Active;
    client.archivedAt = null;

    return this.clientsRepository.save(client);
  }

  async remove(context: RequestContext, clientId: string) {
    const client = await this.findAny(context, clientId);

    if (client.status !== AgencyClientStatus.Archived) {
      throw new BadRequestException(
        'Client must be archived before it can be permanently deleted',
      );
    }

    await this.clientsRepository.remove(client);

    return { deleted: true };
  }

  private async findAny(context: RequestContext, clientId: string) {
    const client = await this.clientsRepository.findOne({
      where: {
        id: clientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  async getOverview(context: RequestContext, clientId: string) {
    const [client, profitability, counters, costCenter] = await Promise.all([
      this.findOneWithProducts(context, clientId),
      this.clientsProfitabilityService.getClientProfitability(
        context,
        clientId,
      ),
      this.getCounters(context, clientId),
      this.clientCostCenterService.findLinkedCostCenter(context, clientId),
    ]);

    return {
      client,
      counters,
      // The web client expects a flat profitability snapshot here (laborHours,
      // revenue, margin...), not the wrapper returned by getClientProfitability.
      profitability:
        (profitability as { profitability?: unknown }).profitability ?? null,
      costCenter,
      recent: null,
    };
  }

  private async loadProductsForClients(clients: AgencyClient[]) {
    const managedTenantIds = Array.from(
      new Set(
        clients
          .map((client) => client.managedTenantId)
          .filter((tenantId): tenantId is string => Boolean(tenantId)),
      ),
    );

    const entitlements = managedTenantIds.length > 0
      ? await this.entitlementsRepository.find({
          where: {
            tenantId: In(managedTenantIds),
            productKey: In([...MANAGEABLE_CLIENT_PRODUCTS]),
          },
        })
      : [];

    const entitlementByTenantAndProduct = new Map(
      entitlements.map((entitlement) => [
        `${entitlement.tenantId}:${entitlement.productKey}`,
        entitlement,
      ]),
    );

    return new Map(
      clients.map((client) => [
        client.id,
        MANAGEABLE_CLIENT_PRODUCTS.map((productKey) =>
          this.toProductSummary(
            productKey,
            client.managedTenantId
              ? entitlementByTenantAndProduct.get(
                  `${client.managedTenantId}:${productKey}`,
                ) ?? null
              : null,
          ),
        ),
      ]),
    );
  }

  private emptyProductSummaries(): ClientProductSummary[] {
    return MANAGEABLE_CLIENT_PRODUCTS.map((productKey) =>
      this.toProductSummary(productKey, null),
    );
  }

  private toProductSummary(
    productKey: ManageableClientProductKey,
    entitlement: TenantProductEntitlementEntity | null,
  ): ClientProductSummary {
    return {
      productKey,
      status: entitlement?.status ?? 'not_configured',
      available: isActiveProductEntitlement(entitlement),
      planKey: entitlement?.planKey ?? null,
      startsAt: entitlement?.startsAt?.toISOString() ?? null,
      endsAt: entitlement?.endsAt?.toISOString() ?? null,
      trialEndsAt: entitlement?.trialEndsAt?.toISOString() ?? null,
    };
  }

  private assertManageableProductKey(productKey: string): ManageableClientProductKey {
    if (!(MANAGEABLE_CLIENT_PRODUCTS as readonly string[]).includes(productKey)) {
      throw new BadRequestException('Unsupported managed client product');
    }
    return productKey as ManageableClientProductKey;
  }

  private async getCounters(context: RequestContext, clientId: string) {
    const openTaskStatuses = [
      TaskStatus.Todo,
      TaskStatus.InProgress,
      TaskStatus.InReview,
      TaskStatus.Approved,
      TaskStatus.Waiting,
      TaskStatus.Blocked,
    ];

    const openActivityStatuses = [
      ActivityStatus.Todo,
      ActivityStatus.Scheduled,
      ActivityStatus.InProgress,
      ActivityStatus.Overdue,
    ];

    const now = new Date();

    // Tasks created inside a client's project carry only project_id, so the
    // task scope must match either the direct client_id or one of the client's
    // project ids.
    const clientProjects = await this.projectsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        clientId,
      },
      select: ['id'],
    });
    const projectIds = clientProjects.map((project) => project.id);
    const taskScopeWhere = projectIds.length
      ? '(task.client_id = :clientId OR task.project_id IN (:...projectIds))'
      : 'task.client_id = :clientId';
    const taskScopeParams = projectIds.length
      ? { clientId, projectIds }
      : { clientId };

    const [activeProjects, openTasks, overdueTasks, openActivities, overdueActivities] =
      await Promise.all([
        this.projectsRepository.count({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            clientId,
            status: ProjectStatus.Active,
            archivedAt: IsNull(),
          },
        }),
        this.tasksRepository
          .createQueryBuilder('task')
          .where('task.tenant_id = :tenantId', { tenantId: context.tenantId })
          .andWhere('task.workspace_id = :workspaceId', {
            workspaceId: context.workspaceId,
          })
          .andWhere(taskScopeWhere, taskScopeParams)
          .andWhere('task.archived_at IS NULL')
          .andWhere('task.status IN (:...statuses)', {
            statuses: openTaskStatuses,
          })
          .getCount(),
        this.tasksRepository
          .createQueryBuilder('task')
          .where('task.tenant_id = :tenantId', { tenantId: context.tenantId })
          .andWhere('task.workspace_id = :workspaceId', {
            workspaceId: context.workspaceId,
          })
          .andWhere(taskScopeWhere, taskScopeParams)
          .andWhere('task.archived_at IS NULL')
          .andWhere('task.due_date IS NOT NULL')
          .andWhere('task.due_date < :now', { now })
          .andWhere('task.status IN (:...statuses)', {
            statuses: openTaskStatuses,
          })
          .getCount(),
        this.countClientActivities(context, clientId, openActivityStatuses),
        this.countClientActivities(context, clientId, openActivityStatuses, now),
      ]);

    return {
      activeProjects,
      openTasks,
      overdueTasks,
      openActivities,
      overdueActivities,
    };
  }

  private countClientActivities(
    context: RequestContext,
    clientId: string,
    statuses: ActivityStatus[],
    overdueBefore?: Date,
  ) {
    const qb = this.activitiesRepository
      .createQueryBuilder('activity')
      .innerJoin(
        AgencyActivityLink,
        'link',
        'link.activity_id = activity.id AND link.tenant_id = activity.tenant_id AND link.workspace_id = activity.workspace_id',
      )
      .where('activity.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('activity.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('activity.archived_at IS NULL')
      .andWhere('activity.status IN (:...statuses)', { statuses })
      .andWhere('link.entity_type = :entityType', {
        entityType: ActivityEntityType.Client,
      })
      .andWhere('link.entity_id = :clientId', { clientId });

    if (overdueBefore) {
      qb.andWhere('activity.due_at IS NOT NULL').andWhere(
        'activity.due_at < :overdueBefore',
        { overdueBefore },
      );
    }

    return qb.getCount();
  }

  private countGrouped(context: RequestContext, column: string) {
    return this.clientsRepository
      .createQueryBuilder('client')
      .select(`client.${column}`, 'key')
      .addSelect('COUNT(client.id)', 'count')
      .where('client.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('client.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('client.archived_at IS NULL')
      .groupBy(`client.${column}`)
      .getRawMany<{ key: string; count: string }>();
  }

  private rowsToCountMap(rows: Array<{ key: string; count: string }>) {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.key] = Number(row.count);
      return acc;
    }, {});
  }

  private parseLimit(limit?: string) {
    const parsed = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
    return Math.min(Math.trunc(parsed), MAX_LIMIT);
  }

  private parseOffset(offset?: string) {
    const parsed = Number(offset ?? 0);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.trunc(parsed);
  }
}
