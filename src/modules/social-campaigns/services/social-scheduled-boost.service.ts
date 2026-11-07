import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import type {
  ScheduleSocialBoostDto,
  UpdateScheduledSocialBoostDto,
} from '../dto';
import { SocialScheduledBoostEntity } from '../entities';
import { SocialBoostRequestService } from './social-boost-request.service';
import type { SocialCampaignsScope } from './social-boost-template.service';

type SchedulablePublicationRow = {
  id: string;
  content_item_id: string;
  status: string;
  provider: string;
  external_asset_id: string;
  asset_type: string;
  placement: string | null;
  asset_metadata: Record<string, unknown> | null;
  connection_metadata: Record<string, unknown> | null;
};

type ListRow = {
  kind: 'scheduled' | 'manual';
  id: string;
  status: string;
  error_code: string | null;
  created_at: Date;
  executed_at: Date | null;
  publication_id: string;
  publication_status: string;
  scheduled_at: Date | null;
  published_at: Date | null;
  external_permalink: string | null;
  asset_type: string;
  channel: string | null;
  placement: string | null;
  content_title: string | null;
  template_id: string;
  template_name: string | null;
  budget_type: string | null;
  budget_amount_minor: string | null;
  currency: string | null;
  duration_days: number | null;
  objective: string | null;
  performance_goal: string | null;
  request_status: string | null;
  request_error_code: string | null;
  request_executed_at: Date | null;
};

/** Placements Meta can boost from an organic post (a Story is not one). */
const BOOSTABLE_PLACEMENTS = new Set(['feed', 'reel', 'reels']);
const STALE_EXECUTION_MS = 15 * 60_000;

/**
 * Boosts authorized at scheduling time (Planner). The person authorizes and
 * acknowledges the spend when scheduling; this service checks the same
 * policy as a manual boost then, and again — through the regular preflight
 * and confirmation — when the runner executes it after the post is published.
 */
@Injectable()
export class SocialScheduledBoostService {
  private readonly logger = new Logger(SocialScheduledBoostService.name);

  constructor(
    @InjectRepository(SocialScheduledBoostEntity, 'agency')
    private readonly boosts: Repository<SocialScheduledBoostEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly boostRequests: SocialBoostRequestService,
  ) {}

  /** Validates a template + account before anything is scheduled. */
  async check(
    scope: SocialCampaignsScope,
    input: { templateId: string; connectionId: string },
  ) {
    const errorCode = await this.boostRequests.evaluateSchedulable(scope, {
      ...input,
      publication: {
        provider: 'meta',
        externalAssetId: '',
        assetType: 'facebook_page',
        assetMetadata: {},
      },
    });
    return { schedulable: errorCode === null, errorCode };
  }

  async schedule(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    dto: ScheduleSocialBoostDto,
  ) {
    const publication = await this.requireSchedulablePublication(
      scope,
      dto.publicationId,
    );
    if (
      !BOOSTABLE_PLACEMENTS.has((publication.placement ?? 'feed').toLowerCase())
    )
      throw this.refusal('boost_placement_not_supported');
    const errorCode = await this.boostRequests.evaluateSchedulable(scope, {
      templateId: dto.templateId,
      connectionId: dto.connectionId,
      publication: this.snapshot(publication),
    });
    if (errorCode) throw this.refusal(errorCode);

    const live = await this.boosts.findOne({
      where: { publicationId: publication.id, ...this.scopeWhere(scope) },
      order: { createdAt: 'DESC' },
    });
    if (live && live.status !== 'cancelled')
      throw new ConflictException({
        code: 'scheduled_boost_exists',
        message: 'scheduled_boost_exists',
      });

    const saved = await this.boosts.save(
      this.boosts.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId ?? null,
        publicationId: publication.id,
        contentItemId: publication.content_item_id,
        boostTemplateId: dto.templateId,
        connectionId: dto.connectionId,
        status: 'pending',
        boostRequestId: null,
        errorCode: null,
        attempts: 0,
        spendAcknowledgedAt: new Date(),
        authorizedById: actorUserId,
        cancelledById: null,
        cancelledAt: null,
        executedAt: null,
      }),
    );
    return { id: saved.id, status: saved.status };
  }

  async updateTemplate(
    scope: SocialCampaignsScope,
    id: string,
    dto: UpdateScheduledSocialBoostDto,
  ) {
    const row = await this.requirePending(scope, id);
    const publication = await this.requireSchedulablePublication(
      scope,
      row.publicationId,
    );
    const errorCode = await this.boostRequests.evaluateSchedulable(scope, {
      templateId: dto.templateId,
      connectionId: row.connectionId,
      publication: this.snapshot(publication),
    });
    if (errorCode) throw this.refusal(errorCode);
    row.boostTemplateId = dto.templateId;
    await this.boosts.save(row);
    return { id: row.id, status: row.status };
  }

  async cancel(
    scope: SocialCampaignsScope,
    actorUserId: string | null,
    id: string,
  ) {
    const row = await this.requirePending(scope, id);
    row.status = 'cancelled';
    row.cancelledById = actorUserId;
    row.cancelledAt = new Date();
    await this.boosts.save(row);
    return { id: row.id, status: row.status };
  }

  /** Scheduled boosts plus manual ones (Publications), newest first. */
  async list(scope: SocialCampaignsScope) {
    const params = [
      scope.tenantId,
      scope.workspaceId,
      scope.agencyClientId,
      scope.companyContextId ?? null,
    ];
    const rows = await this.dataSource.query<ListRow[]>(
      `SELECT 'scheduled' AS kind, b.id, b.status, b.error_code, b.created_at,
              b.executed_at, b.publication_id, p.status AS publication_status,
              p.scheduled_at, p.published_at, p.external_permalink, a.asset_type,
              d.channel, d.placement, item.title AS content_title,
              t.id AS template_id, t.name AS template_name, t.budget_type,
              t.budget_amount_minor::text AS budget_amount_minor, t.currency,
              t.duration_days, t.objective, t.performance_goal,
              r.status AS request_status, r.error_code AS request_error_code,
              r.executed_at AS request_executed_at
         FROM social_scheduled_boosts b
         JOIN social_publications p ON p.id = b.publication_id
         JOIN social_organic_assets a ON a.id = p.asset_id
         LEFT JOIN social_content_destinations d ON d.id = p.destination_id
         JOIN social_content_items item ON item.id = b.content_item_id
         JOIN social_boost_templates t ON t.id = b.boost_template_id
         LEFT JOIN social_boost_requests r ON r.id = b.boost_request_id
        WHERE b.tenant_id = $1 AND b.workspace_id = $2
          AND b.agency_client_id IS NOT DISTINCT FROM $3::uuid
          AND b.company_context_id IS NOT DISTINCT FROM $4::uuid
       UNION ALL
       SELECT 'manual' AS kind, r.id, r.status, r.error_code, r.created_at,
              r.executed_at, r.publication_id, p.status AS publication_status,
              p.scheduled_at, p.published_at, p.external_permalink, a.asset_type,
              d.channel, d.placement, item.title AS content_title,
              t.id AS template_id, t.name AS template_name, t.budget_type,
              t.budget_amount_minor::text AS budget_amount_minor, t.currency,
              t.duration_days, t.objective, t.performance_goal,
              r.status AS request_status, r.error_code AS request_error_code,
              r.executed_at AS request_executed_at
         FROM social_boost_requests r
         JOIN social_publications p ON p.id = r.publication_id
         JOIN social_organic_assets a ON a.id = p.asset_id
         LEFT JOIN social_content_destinations d ON d.id = p.destination_id
         JOIN social_content_items item ON item.id = r.content_item_id
         JOIN social_boost_templates t ON t.id = r.boost_template_id
        WHERE r.tenant_id = $1 AND r.workspace_id = $2
          AND r.agency_client_id IS NOT DISTINCT FROM $3::uuid
          AND t.company_context_id IS NOT DISTINCT FROM $4::uuid
          AND NOT EXISTS (
            SELECT 1 FROM social_scheduled_boosts b WHERE b.boost_request_id = r.id
          )
        ORDER BY created_at DESC
        LIMIT 200`,
      params,
    );
    return {
      items: rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        status: row.status,
        errorCode: row.request_error_code ?? row.error_code,
        requestStatus: row.request_status,
        createdAt: new Date(row.created_at).toISOString(),
        executedAt: this.iso(row.request_executed_at ?? row.executed_at),
        publication: {
          id: row.publication_id,
          status: row.publication_status,
          scheduledAt: this.iso(row.scheduled_at),
          publishedAt: this.iso(row.published_at),
          permalink: row.external_permalink,
          assetType: row.asset_type,
          channel: row.channel,
          placement: row.placement,
          title: row.content_title,
        },
        template: {
          id: row.template_id,
          name: row.template_name,
          budgetType: row.budget_type,
          budgetAmountMinor: row.budget_amount_minor,
          currency: row.currency,
          durationDays: row.duration_days,
          objective: row.objective,
          performanceGoal: row.performance_goal,
        },
      })),
    };
  }

  /**
   * Executes pending boosts whose post is now published, and withdraws the
   * ones whose publication failed or was cancelled. A claim older than the
   * stale window is retried: preflight and confirmation are idempotent on
   * this row's id, so a retry can never create a second Meta structure.
   */
  async runDue(limit = 10): Promise<number> {
    await this.dataSource.query(
      `UPDATE social_scheduled_boosts AS b
          SET status = 'cancelled', error_code = 'publication_not_published',
              cancelled_at = now(), updated_at = now()
         FROM social_publications p
        WHERE p.id = b.publication_id AND b.status = 'pending'
          AND p.status IN ('failed', 'cancelled')`,
    );

    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `SELECT b.id
           FROM social_scheduled_boosts b
           JOIN social_publications p ON p.id = b.publication_id
          WHERE p.status = 'published' AND p.external_publication_id IS NOT NULL
            AND (b.status = 'pending'
                 OR (b.status = 'executing' AND b.updated_at < $2))
          ORDER BY b.created_at
          FOR UPDATE OF b SKIP LOCKED
          LIMIT $1`,
        [limit, new Date(Date.now() - STALE_EXECUTION_MS)],
      );
      if (rows.length === 0) return [];
      await manager.query(
        `UPDATE social_scheduled_boosts
            SET status = 'executing', attempts = attempts + 1, updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [rows.map((row) => row.id)],
      );
      return rows.map((row) => row.id);
    });

    for (const id of ids) await this.execute(id);
    return ids.length;
  }

  private async execute(id: string) {
    const row = await this.boosts.findOne({ where: { id } });
    if (!row) return;
    const scope: SocialCampaignsScope = {
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      agencyClientId: row.agencyClientId,
      companyContextId: row.companyContextId,
    };
    try {
      const request = await this.boostRequests.preflight(
        scope,
        row.authorizedById,
        {
          requestId: row.id,
          publicationId: row.publicationId,
          templateId: row.boostTemplateId,
          connectionId: row.connectionId,
        },
      );
      row.boostRequestId = request.id;
      // A retry finds the request this row already created (same requestId);
      // only a fresh `pending_confirmation` is confirmed.
      const final =
        request.status === 'pending_confirmation'
          ? await this.boostRequests.confirm(
              scope,
              row.authorizedById,
              request.id,
              row.id,
            )
          : request;
      row.status = ['blocked', 'failed', 'expired'].includes(final.status)
        ? 'failed'
        : 'executed';
      row.errorCode = final.errorCode ?? null;
    } catch (error) {
      row.status = 'failed';
      row.errorCode = 'boost_execution_failed';
      this.logger.warn(
        `Scheduled boost ${row.id} failed before Meta: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
    row.executedAt = new Date();
    await this.boosts.save(row);
  }

  private async requirePending(scope: SocialCampaignsScope, id: string) {
    const row = await this.boosts.findOne({
      where: { id, ...this.scopeWhere(scope) },
    });
    if (!row) throw new NotFoundException('Scheduled boost not found.');
    if (row.status !== 'pending')
      throw new ConflictException({
        code: 'scheduled_boost_not_pending',
        message: 'scheduled_boost_not_pending',
      });
    return row;
  }

  private async requireSchedulablePublication(
    scope: SocialCampaignsScope,
    id: string,
  ) {
    const rows = await this.dataSource.query<SchedulablePublicationRow[]>(
      `SELECT p.id, p.content_item_id, p.status, p.provider, p.external_asset_id,
              a.asset_type, d.placement,
              COALESCE(a.metadata, '{}'::jsonb) AS asset_metadata,
              COALESCE(c.metadata, '{}'::jsonb) AS connection_metadata
         FROM social_publications p
         JOIN social_organic_assets a ON a.id = p.asset_id
         JOIN social_organic_connections c ON c.id = p.connection_id
         LEFT JOIN social_content_destinations d ON d.id = p.destination_id
         JOIN social_content_items item ON item.id = p.content_item_id
         JOIN social_plans plan ON plan.id = item.plan_id
        WHERE p.id = $1 AND p.tenant_id = $2 AND p.workspace_id = $3
          AND p.agency_client_id IS NOT DISTINCT FROM $4::uuid
          AND a.company_context_id IS NOT DISTINCT FROM $5::uuid
          AND plan.company_context_id IS NOT DISTINCT FROM $5::uuid
          AND p.status IN ('scheduled', 'queued', 'processing', 'published')`,
      [
        id,
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId ?? null,
      ],
    );
    if (!rows[0])
      throw new NotFoundException('Schedulable Social publication not found.');
    return rows[0];
  }

  private snapshot(row: SchedulablePublicationRow) {
    return {
      provider: row.provider,
      externalAssetId: row.external_asset_id,
      assetType: row.asset_type,
      assetMetadata: {
        ...(row.connection_metadata ?? {}),
        ...(row.asset_metadata ?? {}),
      },
    };
  }

  private scopeWhere(scope: SocialCampaignsScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId == null ? IsNull() : scope.companyContextId,
    };
  }

  /** Stable code in the body: the web client reads `code`, never a message. */
  private refusal(code: string) {
    return new BadRequestException({ code, message: code });
  }

  private iso(value: Date | null) {
    return value ? new Date(value).toISOString() : null;
  }
}
