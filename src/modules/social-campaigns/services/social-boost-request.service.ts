import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { SocialAdAccountConnectionEntity } from '../../social-integrations';
import type { SocialBoostPreflightDto } from '../dto';
import {
  SocialAdActionPolicyEntity,
  SocialBoostRequestEntity,
  SocialBoostTemplateEntity,
} from '../entities';
import { toSocialBoostTemplateView } from '../views/social-boost-template.view';
import { MetaAdsBoostAdapter } from './meta-ads-boost.adapter';
import {
  boostExecutionBlockCode,
  type BoostPublicationSnapshot,
} from './social-boost-execution-policy';
import { SocialAdActionsConfigService } from './social-ad-actions-config.service';
import type { SocialCampaignsScope } from './social-boost-template.service';

type PublicationRow = {
  id: string;
  content_item_id: string;
  provider: string;
  external_asset_id: string;
  external_publication_id: string | null;
  asset_type: string;
  asset_metadata: Record<string, unknown> | null;
  connection_metadata: Record<string, unknown> | null;
};

@Injectable()
export class SocialBoostRequestService {
  constructor(
    @InjectRepository(SocialBoostRequestEntity, 'agency')
    private readonly requests: Repository<SocialBoostRequestEntity>,
    @InjectRepository(SocialBoostTemplateEntity, 'agency')
    private readonly templates: Repository<SocialBoostTemplateEntity>,
    @InjectRepository(SocialAdActionPolicyEntity, 'agency')
    private readonly policies: Repository<SocialAdActionPolicyEntity>,
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connections: Repository<SocialAdAccountConnectionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: SocialAdActionsConfigService,
    private readonly meta: MetaAdsBoostAdapter,
  ) {}

  async preflight(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    dto: SocialBoostPreflightDto,
  ) {
    const existing = await this.requests.findOne({
      where: { requestId: dto.requestId },
    });
    if (existing) {
      await this.assertScope(existing, scope);
      return this.view(existing);
    }

    const connection = await this.requireConnection(scope, dto.connectionId);
    const template = await this.requireTemplate(scope, dto.templateId);
    const publication = await this.requirePublication(scope, dto.publicationId);
    const policy = await this.findPolicy(scope, dto.connectionId);
    let errorCode: string | null = null;
    if (!this.config.writesEnabled) errorCode = 'provider_writes_disabled';
    else if (!policy?.enabled || !policy.allowBoost)
      errorCode = 'boost_disabled_by_policy';
    else if (!template.isActive) errorCode = 'template_inactive';
    else if (connection.currency && template.currency !== connection.currency)
      errorCode = 'currency_mismatch';
    else if (
      policy.maxBudgetMinor &&
      BigInt(template.budgetAmountMinor) > BigInt(policy.maxBudgetMinor)
    )
      errorCode = 'budget_exceeds_policy';

    const snapshot = this.publicationSnapshot(publication);
    errorCode ??= boostExecutionBlockCode(template, snapshot);
    const ttl = policy?.confirmationTtlMinutes ?? 10;
    const row = this.requests.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId: dto.connectionId,
      publicationId: publication.id,
      contentItemId: publication.content_item_id,
      boostTemplateId: template.id,
      status: errorCode ? 'blocked' : 'pending_confirmation',
      requestId: dto.requestId,
      confirmationRequestId: null,
      templateSnapshot: toSocialBoostTemplateView(
        template,
      ) as unknown as Record<string, unknown>,
      publicationSnapshot: {
        provider: snapshot.provider,
        assetType: snapshot.assetType,
        published: true,
      },
      providerResult: null,
      expiresAt: new Date(Date.now() + ttl * 60_000),
      proposedById: actorUserId,
      confirmedById: null,
      errorCode,
      executedAt: null,
    });
    return this.view(await this.requests.save(row));
  }

  async confirm(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    requestId: string,
    confirmationRequestId: string,
  ) {
    const claim = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SocialBoostRequestEntity);
      const row = await repository
        .createQueryBuilder('boost')
        .setLock('pessimistic_write')
        .where('boost.id = :requestId', { requestId })
        .getOne();
      if (!row) throw new NotFoundException('Boost request not found.');
      await this.assertScope(row, scope);
      if (row.confirmationRequestId === confirmationRequestId)
        return { row, shouldExecute: false };
      if (row.confirmationRequestId)
        throw new ConflictException('Boost already confirmed.');
      if (row.status !== 'pending_confirmation')
        throw new ConflictException('Boost cannot be confirmed.');
      if (row.expiresAt.getTime() <= Date.now()) {
        row.status = 'expired';
        await repository.save(row);
        throw new ConflictException('Boost confirmation expired.');
      }
      if (!this.config.writesEnabled)
        throw new ForbiddenException('Meta writes are disabled.');
      const policy = await this.findPolicy(scope, row.connectionId);
      if (!policy?.enabled || !policy.allowBoost)
        throw new ForbiddenException('Boost is disabled by account policy.');
      row.status = 'executing';
      row.confirmationRequestId = confirmationRequestId;
      row.confirmedById = actorUserId;
      return { row: await repository.save(row), shouldExecute: true };
    });
    if (!claim.shouldExecute) return this.view(claim.row);

    const claimed = claim.row;
    try {
      const publication = await this.requirePublication(
        scope,
        claimed.publicationId,
      );
      // Execute the immutable preflight snapshot, never a template edited in
      // another tab after the person reviewed the confirmation.
      const template =
        claimed.templateSnapshot as unknown as SocialBoostTemplateEntity;
      const result = await this.meta.execute({
        ...scope,
        connectionId: claimed.connectionId,
        requestId: claimed.requestId,
        template,
        publication: this.publicationSnapshot(publication),
      });
      claimed.providerResult = result;
      claimed.executedAt = new Date();
      claimed.status = result.providerAccepted ? 'created_active' : 'failed';
      claimed.errorCode = result.providerAccepted
        ? null
        : result.errorCode ??
          (result.stage === 'campaign'
            ? 'provider_create_failed'
            : 'provider_partial_creation_requires_review');
    } catch {
      claimed.status = 'failed';
      claimed.errorCode = 'provider_create_failed';
      claimed.providerResult = null;
      claimed.executedAt = new Date();
    }
    return this.view(await this.requests.save(claimed));
  }

  private async requirePublication(scope: SocialCampaignsScope, id: string) {
    const rows = await this.dataSource.query<PublicationRow[]>(
      `SELECT p.id, p.content_item_id, p.provider, p.external_asset_id,
              p.external_publication_id, a.asset_type,
              COALESCE(a.metadata, '{}'::jsonb) AS asset_metadata,
              COALESCE(c.metadata, '{}'::jsonb) AS connection_metadata
         FROM social_publications p
         JOIN social_organic_assets a ON a.id = p.asset_id
         JOIN social_organic_connections c ON c.id = p.connection_id
         JOIN social_content_items item ON item.id = p.content_item_id
         JOIN social_plans plan ON plan.id = item.plan_id
        WHERE p.id = $1 AND p.tenant_id = $2 AND p.workspace_id = $3
          AND p.agency_client_id IS NOT DISTINCT FROM $4::uuid
          AND a.company_context_id IS NOT DISTINCT FROM $5::uuid
          AND plan.company_context_id IS NOT DISTINCT FROM $5::uuid
          AND p.status = 'published' AND p.external_publication_id IS NOT NULL`,
      [
        id,
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    if (!rows[0])
      throw new NotFoundException('Published Social publication not found.');
    return rows[0];
  }

  private publicationSnapshot(row: PublicationRow): BoostPublicationSnapshot {
    return {
      provider: row.provider,
      externalPublicationId: row.external_publication_id!,
      externalAssetId: row.external_asset_id,
      assetType: row.asset_type,
      assetMetadata: {
        ...(row.connection_metadata ?? {}),
        ...(row.asset_metadata ?? {}),
      },
    };
  }

  private async requireConnection(scope: SocialCampaignsScope, id: string) {
    const row = await this.connections.findOne({
      where: {
        ...this.connectionScopeWhere(scope),
        id,
        provider: 'meta_ads',
        connectionStatus: 'connected',
      },
    });
    if (!row) throw new NotFoundException('Connected Meta account not found.');
    return row;
  }

  private async requireTemplate(scope: SocialCampaignsScope, id: string) {
    const row = await this.templates.findOne({
      where: { ...this.templateScopeWhere(scope), id },
    });
    if (!row) throw new NotFoundException('Boost template not found.');
    return row;
  }

  private findPolicy(scope: SocialCampaignsScope, connectionId: string) {
    return this.policies.findOne({
      where: { ...this.baseScopeWhere(scope), connectionId },
    });
  }

  private baseScopeWhere(scope: SocialCampaignsScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private connectionScopeWhere(scope: SocialCampaignsScope) {
    return {
      ...this.baseScopeWhere(scope),
      companyContextId:
        scope.companyContextId == null ? IsNull() : scope.companyContextId,
    };
  }

  private templateScopeWhere(scope: SocialCampaignsScope) {
    return this.connectionScopeWhere(scope);
  }

  private async assertScope(
    row: SocialBoostRequestEntity,
    scope: SocialCampaignsScope,
  ): Promise<void> {
    if (
      row.tenantId !== scope.tenantId ||
      row.workspaceId !== scope.workspaceId ||
      row.agencyClientId !== scope.agencyClientId
    ) {
      throw new NotFoundException('Boost request not found.');
    }
    await Promise.all([
      this.requireConnection(scope, row.connectionId),
      this.requireTemplate(scope, row.boostTemplateId),
      this.requirePublication(scope, row.publicationId),
    ]);
  }

  private view(row: SocialBoostRequestEntity) {
    const provider = row.providerResult as {
      providerAccepted?: boolean;
      stage?: string;
      created?: Record<string, string>;
      errorCode?: string;
    } | null;
    return {
      id: row.id,
      connectionId: row.connectionId,
      publicationId: row.publicationId,
      template: row.templateSnapshot,
      publication: row.publicationSnapshot,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      errorCode: row.errorCode,
      result: provider
        ? {
            providerAccepted: provider.providerAccepted === true,
            stoppedAt: provider.stage ?? null,
            createdLevels: Object.keys(provider.created ?? {}),
            allObjectsPaused: false,
            allObjectsActive: provider.providerAccepted === true,
          }
        : null,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      executedAt: row.executedAt?.toISOString() ?? null,
      manualOnly: true,
    };
  }
}
