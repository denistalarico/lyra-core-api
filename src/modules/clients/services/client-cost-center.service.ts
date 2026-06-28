import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FinanceCostCenter } from '../../finance/entities';
import { FinanceCostCenterType } from '../../finance/enums';
import { AgencyClient } from '../entities';

const AGENCY_CONNECTION = 'agency';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

export type EnsureCostCenterAction = 'existing' | 'linked' | 'created';

export interface EnsureCostCenterResult {
  costCenter: FinanceCostCenter;
  action: EnsureCostCenterAction;
}

export interface SyncCostCentersResult {
  processed: number;
  created: number;
  linked: number;
  existing: number;
}

function costCenterNameForClient(client: AgencyClient): string {
  return `Cliente — ${client.displayName}`;
}

/**
 * Creates/links one FinanceCostCenter per client so the
 * `use_client_cost_center` strategy can resolve a cost center on generated
 * invoices. Lives in the Clients module and only touches the cost-center repo,
 * so neither FinancePostingService nor the invoice logic is modified.
 *
 * Idempotent: re-running never duplicates a cost center for the same client.
 */
@Injectable()
export class ClientCostCenterService {
  private readonly logger = new Logger(ClientCostCenterService.name);

  constructor(
    @InjectRepository(FinanceCostCenter, AGENCY_CONNECTION)
    private readonly costCentersRepo: Repository<FinanceCostCenter>,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepo: Repository<AgencyClient>,
  ) {}

  /** Best-effort variant used as a side effect of client creation. */
  async ensureForClientSafe(
    context: RequestContext,
    client: AgencyClient,
  ): Promise<EnsureCostCenterResult | null> {
    try {
      return await this.ensureForClient(context, client);
    } catch (error) {
      this.logger.error(
        `Failed to ensure cost center for client ${client.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Returns the cost center linked to a client, creating or linking one when
   * needed. Tenant/workspace scoped end-to-end.
   */
  async ensureForClient(
    context: RequestContext,
    client: AgencyClient,
  ): Promise<EnsureCostCenterResult> {
    // 1. Already linked to this client → no-op (idempotency).
    const linked = await this.findLinkedCostCenter(context, client.id);
    if (linked) {
      return { costCenter: linked, action: 'existing' };
    }

    const name = costCenterNameForClient(client);

    // 2. An unlinked cost center with the same name in the same tenant/
    //    workspace → reuse it instead of creating a duplicate.
    const reusable = await this.costCentersRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name,
        relatedEntityId: IsNull(),
      },
    });
    if (reusable) {
      reusable.type = FinanceCostCenterType.Client;
      reusable.relatedEntityType = 'client';
      reusable.relatedEntityId = client.id;
      reusable.active = true;
      reusable.metadata = {
        ...(reusable.metadata ?? {}),
        source: 'client_auto_link',
        clientId: client.id,
      };
      const saved = await this.costCentersRepo.save(reusable);
      return { costCenter: saved, action: 'linked' };
    }

    // 3. Create a fresh cost center for the client.
    const created = await this.costCentersRepo.save(
      this.costCentersRepo.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        name,
        type: FinanceCostCenterType.Client,
        relatedEntityType: 'client',
        relatedEntityId: client.id,
        active: true,
        metadata: { source: 'client_auto', clientId: client.id },
      }),
    );
    return { costCenter: created, action: 'created' };
  }

  /** Returns the cost center linked to a client id, if any. */
  findLinkedCostCenter(
    context: RequestContext,
    clientId: string,
  ): Promise<FinanceCostCenter | null> {
    return this.costCentersRepo.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        type: FinanceCostCenterType.Client,
        relatedEntityType: 'client',
        relatedEntityId: clientId,
      },
    });
  }

  /**
   * Backfills cost centers for every non-archived client in the workspace that
   * does not yet have one. Idempotent and safe to re-run.
   */
  async syncAll(context: RequestContext): Promise<SyncCostCentersResult> {
    const clients = await this.clientsRepo.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        archivedAt: IsNull(),
      },
    });

    const result: SyncCostCentersResult = {
      processed: 0,
      created: 0,
      linked: 0,
      existing: 0,
    };

    for (const client of clients) {
      const outcome = await this.ensureForClientSafe(context, client);
      result.processed += 1;
      if (!outcome) continue;
      result[outcome.action] += 1;
    }

    return result;
  }
}
