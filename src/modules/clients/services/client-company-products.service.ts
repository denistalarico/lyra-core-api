import { AgencyClientStatus } from '../enums';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import {
  CompanyProductRegistry,
  type CompanyProductOperation,
  type PendingCompanyWork,
} from '../../../common/company-products/company-product.registry';
import { isActiveProductEntitlement } from '../../../common/context/product-entitlement-availability';
import { AgencyClient } from '../entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../entities/agency-client-company-context.entity';
import {
  AgencyClientCompanyProduct,
  AgencyClientCompanyProductEvent,
  type CompanyProductKey,
  type CompanyRemovalMode,
} from '../entities/agency-client-company-product.entity';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import {
  PlatformProductKey,
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from '../../platform/enums/platform-product.enums';
import {
  ClientManagedTenantProvisioningService,
  type CompanyProductContext,
} from './client-managed-tenant-provisioning.service';
import { ClientNotificationPublisher } from './client-notification.publisher';
import { ClientsService } from './clients.service';

const LIVE = ['scheduled', 'queued', 'processing'];
export function companyProductKey(value: string): CompanyProductKey {
  if (value !== 'social' && value !== 'leadflow')
    throw new NotFoundException('Product not found.');
  return value;
}
export function companyProductView(p: AgencyClientCompanyProduct) {
  return {
    id: p.id,
    companyContextId: p.companyContextId,
    productKey: p.productKey,
    status: p.status,
    activatedAt: p.activatedAt.toISOString(),
    removalRequestedAt: p.removalRequestedAt?.toISOString() ?? null,
    removalMode: p.removalMode,
    removedAt: p.removedAt?.toISOString() ?? null,
    unavailableReason:
      p.status === 'removal_blocked'
        ? 'publication_failed'
        : p.status === 'removal_scheduled'
          ? 'removal_scheduled'
          : p.status === 'removed'
            ? 'removed'
            : null,
  };
}

@Injectable()
export class ClientCompanyProductsService {
  private readonly logger = new Logger(ClientCompanyProductsService.name);
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly registry: CompanyProductRegistry,
    private readonly provisioning: ClientManagedTenantProvisioningService,
    private readonly notifications: ClientNotificationPublisher,
    private readonly clients: ClientsService,
  ) {}

  private async locked<T>(
    ctx: CompanyProductContext,
    id: string,
    run: (
      manager: EntityManager,
      client: AgencyClient,
      afterCommit: CompanyProductOperation['afterCommit'],
    ) => Promise<T>,
  ): Promise<T> {
    const afterCommit: CompanyProductOperation['afterCommit'] = [];
    const result = await this.db.transaction(async (manager) => {
      // Only this trusted lifecycle transaction may insert retry attempts while pending.
      await manager.query(
        "SELECT set_config('lyra.company_product_lifecycle','on',true)",
      );
      const client = await manager.getRepository(AgencyClient).findOne({
        where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!client) throw new NotFoundException('Client not found.');
      return run(manager, client, afterCommit);
    });
    for (const callback of afterCommit)
      try {
        await callback();
      } catch (error) {
        this.logger.error(
          'Company product post-commit action failed',
          error instanceof Error ? error.stack : String(error),
        );
      }
    return result;
  }
  private async company(
    manager: EntityManager,
    ctx: CompanyProductContext,
    clientId: string,
    companyId: string,
  ) {
    const company = await manager
      .getRepository(AgencyClientCompanyContext)
      .findOne({
        where: {
          id: companyId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          agencyClientId: clientId,
        },
      });
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }
  private operation(
    manager: EntityManager,
    ctx: CompanyProductContext,
    clientId: string,
    companyId: string,
    afterCommit: CompanyProductOperation['afterCommit'],
  ): CompanyProductOperation {
    return {
      manager,
      scope: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        agencyClientId: clientId,
        companyContextId: companyId,
      },
      actorUserId: ctx.userId,
      afterCommit,
    };
  }
  private async work(op: CompanyProductOperation, key: CompanyProductKey) {
    const items: PendingCompanyWork[] = [];
    for (const participant of this.registry.forProduct(key))
      items.push(...(await participant.pending(op)));
    return items;
  }
  private current(
    manager: EntityManager,
    op: CompanyProductOperation,
    key: CompanyProductKey,
  ) {
    return manager.getRepository(AgencyClientCompanyProduct).findOne({
      where: { ...op.scope, productKey: key, status: Not('removed') },
      lock: { mode: 'pessimistic_write' },
    });
  }
  private async event(
    op: CompanyProductOperation,
    p: AgencyClientCompanyProduct,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await op.manager.getRepository(AgencyClientCompanyProductEvent).save({
      tenantId: p.tenantId,
      workspaceId: p.workspaceId,
      agencyClientId: p.agencyClientId,
      companyContextId: p.companyContextId,
      productId: p.id,
      productKey: p.productKey,
      actorUserId: op.actorUserId,
      action,
      metadata,
    });
  }
  async activate(
    ctx: CompanyProductContext,
    clientId: string,
    companyId: string,
    key: CompanyProductKey,
  ) {
    return this.locked(ctx, clientId, async (manager, client, afterCommit) => {
      const company = await this.company(manager, ctx, clientId, companyId);
      const contact = await manager.getRepository(ContactEntity).findOne({
        where: {
          id: company.companyContactId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          type: 'organization',
          status: 'active',
        },
      });
      if (
        !contact ||
        company.status !== 'active' ||
        company.archivedAt ||
        client.status !== AgencyClientStatus.Active ||
        client.archivedAt
      )
        throw new NotFoundException('Active company not found.');
      if (client.archiveStatus !== 'none')
        throw new ConflictException({
          code: 'client_archive_scheduled',
          message: 'Client archival is pending.',
        });
      const provisioned = await this.provisioning.ensureInTransaction(
        manager,
        ctx,
        clientId,
      );
      const op = this.operation(manager, ctx, clientId, companyId, afterCommit);
      const existing = await this.current(manager, op, key);
      if (existing && existing.status !== 'active')
        throw new ConflictException({
          code: 'company_product_removal_scheduled',
          message: 'Cancel the pending removal first.',
        });
      const entitlements = manager.getRepository(
        TenantProductEntitlementEntity,
      );
      let entitlement = await entitlements.findOne({
        where: {
          tenantId: provisioned.client.managedTenantId!,
          productKey: key as PlatformProductKey,
        },
        lock: { mode: 'pessimistic_write' },
      });
      entitlement = entitlements.create({
        ...entitlement,
        tenantId: provisioned.client.managedTenantId!,
        productKey: key as PlatformProductKey,
        status: ProductEntitlementStatus.Active,
        source: ProductEntitlementSource.Manual,
        startsAt:
          entitlement?.startsAt && entitlement.startsAt < new Date()
            ? entitlement.startsAt
            : new Date(),
        endsAt:
          entitlement?.endsAt && entitlement.endsAt > new Date()
            ? entitlement.endsAt
            : null,
        settings: entitlement?.settings ?? {},
      });
      await entitlements.save(entitlement);
      let settingsId: string | null = null;
      for (const participant of this.registry.forProduct(key))
        if (participant.activate)
          settingsId = (await participant.activate(op)) ?? settingsId;
      const repo = manager.getRepository(AgencyClientCompanyProduct);
      const p =
        existing ??
        (await repo.save(
          repo.create({
            ...op.scope,
            productKey: key,
            status: 'active',
            activatedAt: new Date(),
            activatedBy: ctx.userId,
            metadata: {},
          }),
        ));
      if (!existing) await this.event(op, p, 'activated');
      if (provisioned.connected)
        afterCommit.push(() =>
          this.notifications.publishManagedTenantConnected({
            client: provisioned.client,
            actorUserId: ctx.userId,
          }),
        );
      return { ...companyProductView(p), leadflowSettingsId: settingsId };
    });
  }
  async pending(
    ctx: CompanyProductContext,
    clientId: string,
    companyId: string,
    key: CompanyProductKey,
  ) {
    return this.locked(ctx, clientId, async (manager, _client, afterCommit) => {
      await this.company(manager, ctx, clientId, companyId);
      const all = await this.work(
        this.operation(manager, ctx, clientId, companyId, afterCommit),
        key,
      );
      const items = all.filter(
        (w) => w.kind !== 'publication' || LIVE.includes(w.status),
      );
      return {
        items,
        counts: Object.fromEntries(
          ['publication', 'approval', 'automation', 'agent', 'appointment'].map(
            (kind) => [kind, items.filter((w) => w.kind === kind).length],
          ),
        ),
      };
    });
  }
  private async finish(
    op: CompanyProductOperation,
    p: AgencyClientCompanyProduct,
    client: AgencyClient,
  ) {
    for (const participant of this.registry.forProduct(p.productKey))
      await participant.remove?.(op);
    p.status = 'removed';
    p.removedAt = new Date();
    p.removedBy = op.actorUserId;
    await op.manager.getRepository(AgencyClientCompanyProduct).save(p);
    await this.event(op, p, 'removed', {
      mode: p.removalMode,
      reason: p.metadata.reason ?? null,
    });
    const remaining = await op.manager
      .getRepository(AgencyClientCompanyProduct)
      .count({
        where: {
          tenantId: p.tenantId,
          workspaceId: p.workspaceId,
          agencyClientId: p.agencyClientId,
          productKey: p.productKey,
          status: Not('removed'),
        },
      });
    if (!remaining && client.managedTenantId)
      await op.manager.getRepository(TenantProductEntitlementEntity).update(
        {
          tenantId: client.managedTenantId,
          productKey: p.productKey as PlatformProductKey,
        },
        { status: ProductEntitlementStatus.Suspended },
      );
  }
  async remove(
    ctx: CompanyProductContext,
    clientId: string,
    companyId: string,
    key: CompanyProductKey,
    mode: CompanyRemovalMode,
    reason?: string,
  ) {
    if (key === 'leadflow' && mode !== 'immediate')
      throw new BadRequestException('LeadFlow removal must be immediate.');
    return this.locked(ctx, clientId, async (manager, client, afterCommit) => {
      await this.company(manager, ctx, clientId, companyId);
      const op = this.operation(manager, ctx, clientId, companyId, afterCommit);
      const p = await this.current(manager, op, key);
      if (!p)
        return {
          companyContextId: companyId,
          productKey: key,
          status: 'removed',
        };
      if (client.archiveStatus !== 'none')
        throw new ConflictException({
          code: 'client_archive_scheduled',
          message: 'Use the client archival controls.',
        });
      if (p.status !== 'active' && mode === 'after_last_publication')
        return companyProductView(p);
      p.removalRequestedAt = new Date();
      p.removalRequestedBy = ctx.userId;
      p.removalMode = mode;
      const work = await this.work(op, key);
      const publications = work.filter(
        (w) => w.kind === 'publication' && LIVE.includes(w.status),
      );
      p.metadata = {
        ...p.metadata,
        reason: reason ?? null,
        publicationIds: publications.map((w) => w.id),
      };
      if (mode === 'after_last_publication' && publications.length) {
        p.status = 'removal_scheduled';
        await manager.getRepository(AgencyClientCompanyProduct).save(p);
        await this.event(op, p, 'removal_scheduled', {
          reason: reason ?? null,
        });
      } else await this.finish(op, p, client);
      return companyProductView(p);
    });
  }
  async action(
    ctx: CompanyProductContext,
    clientId: string,
    companyId: string,
    key: CompanyProductKey,
    action: 'retry' | 'remove-now' | 'cancel-removal',
  ) {
    if (action === 'remove-now')
      return this.remove(ctx, clientId, companyId, key, 'immediate');
    return this.locked(ctx, clientId, async (manager, client, afterCommit) => {
      await this.company(manager, ctx, clientId, companyId);
      if (client.archiveStatus !== 'none')
        throw new ConflictException({
          code: 'client_archive_scheduled',
          message: 'Use the client archival controls.',
        });
      const op = this.operation(manager, ctx, clientId, companyId, afterCommit);
      const p = await this.current(manager, op, key);
      if (!p) throw new NotFoundException('Product not found.');
      if (action === 'cancel-removal') {
        if (p.status === 'active') return companyProductView(p);
        p.status = 'active';
        p.removalRequestedAt = null;
        p.removalRequestedBy = null;
        p.removalMode = null;
        p.metadata = {};
      } else {
        if (p.status !== 'removal_blocked')
          throw new ConflictException('Removal is not blocked.');
        p.metadata = { ...p.metadata, publicationIds: await this.retry(op, p) };
        p.status = 'removal_scheduled';
      }
      await manager.getRepository(AgencyClientCompanyProduct).save(p);
      await this.event(op, p, action);
      return companyProductView(p);
    });
  }
  private tracked(p: AgencyClientCompanyProduct) {
    return Array.isArray(p.metadata.publicationIds)
      ? p.metadata.publicationIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [];
  }
  private async retry(
    op: CompanyProductOperation,
    p: AgencyClientCompanyProduct,
  ) {
    const ids = this.tracked(p);
    const work = await this.work(op, p.productKey);
    const failed = work
      .filter((w) => ids.includes(w.id) && w.status === 'failed')
      .map((w) => w.id);
    const replacements: string[] = [];
    for (const participant of this.registry.forProduct(p.productKey))
      if (participant.retry)
        replacements.push(...(await participant.retry(op, failed)));
    return [...ids.filter((id) => !failed.includes(id)), ...replacements];
  }
  private async reconcileProduct(
    op: CompanyProductOperation,
    p: AgencyClientCompanyProduct,
    client: AgencyClient,
  ) {
    const work = await this.work(op, p.productKey);
    const ids = this.tracked(p);
    if (
      work.some(
        (w) =>
          w.kind === 'publication' &&
          ids.includes(w.id) &&
          w.status === 'failed',
      )
    ) {
      p.status = 'removal_blocked';
      await op.manager.getRepository(AgencyClientCompanyProduct).save(p);
      await this.event(op, p, 'removal_blocked');
      const requestedBy = p.removalRequestedBy;
      op.afterCommit.push(() =>
        this.notifications.publishProductRemovalBlocked({
          client,
          actorUserId: null,
          requestedBy,
          productKey: p.productKey,
          companyContextId: p.companyContextId,
          occurredAt: p.updatedAt,
        }),
      );
      return false;
    }
    if (work.some((w) => w.kind === 'publication' && LIVE.includes(w.status)))
      return false;
    await this.finish(op, p, client);
    return true;
  }
  async archive(
    ctx: CompanyProductContext,
    clientId: string,
    mode: CompanyRemovalMode = 'immediate',
  ) {
    const result = await this.locked(
      ctx,
      clientId,
      async (manager, client, afterCommit) => {
        if (client.archivedAt) return { client, ready: false };
        if (
          mode === 'after_last_publication' &&
          client.archiveStatus !== 'none'
        )
          return { client, ready: false };
        const companies = await manager
          .getRepository(AgencyClientCompanyContext)
          .find({
            where: {
              tenantId: ctx.tenantId,
              workspaceId: ctx.workspaceId,
              agencyClientId: clientId,
            },
          });
        const repo = manager.getRepository(AgencyClientCompanyProduct);
        const rows = await repo.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            agencyClientId: clientId,
            status: Not('removed'),
          },
        });
        let hasPending = false;
        for (const c of companies) {
          const op = this.operation(manager, ctx, clientId, c.id, afterCommit);
          const publications = (await this.work(op, 'social')).filter(
            (w) => w.kind === 'publication' && LIVE.includes(w.status),
          );
          hasPending ||= publications.length > 0;
          // Include legacy publications even if this company has no live Social product row.
          if (
            publications.length &&
            !rows.some(
              (p) => p.companyContextId === c.id && p.productKey === 'social',
            )
          )
            rows.push(
              repo.create({
                ...op.scope,
                productKey: 'social',
                status: 'active',
                activatedAt: new Date(),
                metadata: {},
              }),
            );
          for (const p of rows.filter((p) => p.companyContextId === c.id)) {
            p.removalRequestedAt = new Date();
            p.removalRequestedBy = ctx.userId;
            p.removalMode = mode;
            p.metadata = {
              ...p.metadata,
              archive: true,
              publicationIds: [
                ...new Set([
                  ...this.tracked(p),
                  ...publications.map((w) => w.id),
                ]),
              ],
            };
            if (mode === 'immediate') {
              if (!p.id) await repo.save(p);
              await this.finish(op, p, client);
            } else {
              p.status = 'removal_scheduled';
              await repo.save(p);
              await this.event(op, p, 'archive_scheduled');
            }
          }
        }
        client.archiveRequestedAt = new Date();
        client.archiveRequestedBy = ctx.userId;
        client.archiveMode = mode;
        // Keep the gate shut across the commit → CA5 archiveEffective boundary, even with no pending posts.
        client.archiveStatus = 'scheduled';
        await manager.getRepository(AgencyClient).save(client);
        if (mode === 'immediate') {
          await this.pauseLegacyLeadflow(manager, ctx, clientId, afterCommit);
          return {
            client: await this.clients.archiveEffective(ctx, clientId, {
              manager,
              afterCommit,
            }),
            ready: false,
          };
        }
        return { client, ready: !hasPending };
      },
    );
    if (result.ready) {
      await this.reconcileClient(ctx, clientId);
      return this.db.getRepository(AgencyClient).findOneByOrFail({
        id: clientId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      });
    }
    return result.client;
  }
  async archiveAction(
    ctx: CompanyProductContext,
    clientId: string,
    action: 'retry' | 'remove-now' | 'cancel-removal',
  ) {
    if (action === 'remove-now')
      return this.archive(ctx, clientId, 'immediate');
    return this.locked(ctx, clientId, async (manager, client, afterCommit) => {
      if (client.archiveStatus === 'none')
        throw new ConflictException('No pending archival.');
      const rows = await manager
        .getRepository(AgencyClientCompanyProduct)
        .find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            agencyClientId: clientId,
            status: In(['removal_scheduled', 'removal_blocked']),
          },
        });
      for (const p of rows) {
        const op = this.operation(
          manager,
          ctx,
          clientId,
          p.companyContextId,
          afterCommit,
        );
        if (p.metadata.archive !== true) continue;
        if (action === 'retry') {
          p.metadata = {
            ...p.metadata,
            publicationIds: await this.retry(op, p),
          };
          p.status = 'removal_scheduled';
        } else {
          p.status = 'active';
          p.removalRequestedAt = null;
          p.removalRequestedBy = null;
          p.removalMode = null;
          p.metadata = {};
        }
        await manager.getRepository(AgencyClientCompanyProduct).save(p);
        await this.event(op, p, `archive_${action}`);
      }
      client.archiveStatus = action === 'retry' ? 'scheduled' : 'none';
      if (action === 'cancel-removal') {
        client.archiveRequestedAt = null;
        client.archiveRequestedBy = null;
        client.archiveMode = null;
      }
      return manager.getRepository(AgencyClient).save(client);
    });
  }
  async reconcileClient(ctx: CompanyProductContext, clientId: string) {
    await this.locked(ctx, clientId, async (manager, client, afterCommit) => {
      if (client.archiveStatus === 'blocked') return false;
      const rows = await manager
        .getRepository(AgencyClientCompanyProduct)
        .find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            agencyClientId: clientId,
            status: In(['removal_scheduled', 'removal_blocked']),
          },
        });
      const archival = client.archiveStatus === 'scheduled';
      // An archival waits for every company before disabling any product.
      if (archival) {
        let waiting = false;
        for (const p of rows) {
          const op = this.operation(
            manager,
            ctx,
            clientId,
            p.companyContextId,
            afterCommit,
          );
          const work = await this.work(op, p.productKey);
          if (
            work.some(
              (w) =>
                w.kind === 'publication' &&
                this.tracked(p).includes(w.id) &&
                w.status === 'failed',
            )
          ) {
            if (p.status !== 'removal_blocked')
              await this.reconcileProduct(op, p, client);
            client.archiveStatus = 'blocked';
            await manager.getRepository(AgencyClient).save(client);
            return false;
          }
          waiting ||= work.some(
            (w) => w.kind === 'publication' && LIVE.includes(w.status),
          );
        }
        if (waiting) return false;
      }
      for (const p of rows)
        if (p.status === 'removal_scheduled')
          await this.reconcileProduct(
            this.operation(
              manager,
              ctx,
              clientId,
              p.companyContextId,
              afterCommit,
            ),
            p,
            client,
          );
      if (archival) {
        await this.pauseLegacyLeadflow(manager, ctx, clientId, afterCommit);
        await this.clients.archiveEffective(ctx, clientId, {
          manager,
          afterCommit,
        });
      }
      return false;
    });
  }
  private async pauseLegacyLeadflow(
    manager: EntityManager,
    ctx: CompanyProductContext,
    clientId: string,
    afterCommit: CompanyProductOperation['afterCommit'],
  ) {
    // Stop retained robots even when their product had no live row.
    const companies = await manager
      .getRepository(AgencyClientCompanyContext)
      .find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          agencyClientId: clientId,
        },
      });
    for (const company of companies) {
      const op = this.operation(
        manager,
        ctx,
        clientId,
        company.id,
        afterCommit,
      );
      for (const participant of this.registry.forProduct('leadflow'))
        await participant.remove?.(op);
    }
  }
  async reconcilePending() {
    const clients = await this.db
      .getRepository(AgencyClient)
      .createQueryBuilder('c')
      .where(
        "c.archive_status='scheduled' OR EXISTS(SELECT 1 FROM agency_client_company_products p WHERE p.agency_client_id=c.id AND p.tenant_id=c.tenant_id AND p.workspace_id=c.workspace_id AND p.status='removal_scheduled')",
      )
      .getMany();
    for (const c of clients)
      try {
        await this.reconcileClient(
          { tenantId: c.tenantId, workspaceId: c.workspaceId, userId: null },
          c.id,
        );
      } catch (error) {
        this.logger.error(
          `Company product reconciliation failed for ${c.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
  }
  async matrix(ctx: CompanyProductContext, clientId: string) {
    return this.locked(ctx, clientId, async (manager, client, afterCommit) => {
      const companies = await manager
        .getRepository(AgencyClientCompanyContext)
        .find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            agencyClientId: clientId,
          },
        });
      const rows = await manager
        .getRepository(AgencyClientCompanyProduct)
        .find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            agencyClientId: clientId,
          },
          order: { createdAt: 'DESC' },
        });
      const entitlement = client.managedTenantId
        ? await manager
            .getRepository(TenantProductEntitlementEntity)
            .find({ where: { tenantId: client.managedTenantId } })
        : [];
      const items: Array<{
        companyContextId: string;
        displayName: string;
        status: string;
        products: Array<{
          productKey: string;
          status: string;
          available: boolean;
          unavailableReason: string | null;
          remainingPublications: number;
          capacity?: {
            activeCompanies: number;
            limit: number | null;
            availableSlots: number | null;
          } | null;
        }>;
      }> = [];
      for (const c of companies) {
        const contact = await manager.getRepository(ContactEntity).findOne({
          where: {
            id: c.companyContactId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
          },
        });
        const products: Array<{
          productKey: string;
          status: string;
          available: boolean;
          unavailableReason: string | null;
          remainingPublications: number;
          capacity?: {
            activeCompanies: number;
            limit: number | null;
            availableSlots: number | null;
          } | null;
        }> = [];
        for (const key of ['leadflow', 'social'] as const) {
          const p = rows.find(
            (p) => p.companyContextId === c.id && p.productKey === key,
          );
          const capacityParticipant =
            key === 'leadflow'
              ? this.registry
                  .forProduct(key)
                  .find((p) => typeof p.capacity === 'function')
              : undefined;
          const capacity = capacityParticipant?.capacity
            ? await capacityParticipant.capacity(
                this.operation(manager, ctx, clientId, c.id, afterCommit),
              )
            : null;
          const unavailableReason = client.archivedAt
            ? 'client_archived'
            : client.archiveStatus !== 'none'
              ? 'client_archive_scheduled'
              : c.status !== 'active' ||
                  c.archivedAt ||
                  contact?.status !== 'active'
                ? 'company_archived'
                : (!p || p.status === 'removed') &&
                    capacity?.availableSlots === 0
                  ? 'company_capacity_exceeded'
                  : p && p.status !== 'active'
                    ? companyProductView(p).unavailableReason
                    : !p
                      ? 'not_activated'
                      : !isActiveProductEntitlement(
                            entitlement.find(
                              (e) =>
                                e.productKey === (key as PlatformProductKey),
                            ),
                          )
                        ? 'entitlement_unavailable'
                        : null;
          const pending =
            p && p.status !== 'removed'
              ? await this.work(
                  this.operation(manager, ctx, clientId, c.id, afterCommit),
                  key,
                )
              : [];
          products.push({
            productKey: key,
            status: p?.status ?? 'not_activated',
            available: !unavailableReason,
            unavailableReason,
            capacity,
            remainingPublications: pending.filter(
              (w) => w.kind === 'publication' && LIVE.includes(w.status),
            ).length,
          });
        }
        items.push({
          companyContextId: c.id,
          displayName: contact?.displayName ?? '',
          status: c.status,
          products,
        });
      }
      return {
        clientId,
        archiveStatus: client.archiveStatus,
        unavailableReason: companies.length ? null : 'company_required',
        items,
      };
    });
  }
}
