import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SocialOrganicAssetEntity } from '../entities';
import {
  SocialOrganicWebhookEventEntity,
  type SocialOrganicWebhookEventStatus,
  type SocialOrganicWebhookScopeResolution,
} from './entities/social-organic-webhook-event.entity';

const UNIQUE_VIOLATION = '23505';

export const SOCIAL_ORGANIC_WEBHOOK_LEASE_MS = 5 * 60_000;

export type SocialOrganicWebhookIngestInput = {
  provider: string;
  eventKey: string;
  objectType: string;
  externalAssetId: string | null;
  rawPayload: Record<string, unknown>;
};

export type SocialOrganicWebhookIngestResult = {
  eventId: string;
  duplicate: boolean;
  scopeResolution: SocialOrganicWebhookScopeResolution;
};

export type ResolvedWebhookScope = {
  scopeResolution: SocialOrganicWebhookScopeResolution;
  tenantId: string | null;
  workspaceId: string | null;
  agencyClientId: string | null;
  companyContextId: string | null;
  assetId: string | null;
};

function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  const [first] = result as unknown[];
  return Array.isArray(first) ? (first as T[]) : (result as T[]);
}

/**
 * Durable receipt and queue for organic webhook deliveries.
 *
 * The HTTP path calls exactly one method — `ingest()` — and that method does
 * exactly two things: resolve scope with one indexed lookup, and INSERT. No
 * Graph call, no analytics sync, no publishing, no notification. Everything
 * else in this file exists for the worker, which runs on its own tick after
 * the 200 has already been sent (blueprint §13.1 rule 3: a slow handler earns
 * provider-side retries and eventually an unsubscription).
 */
@Injectable()
export class SocialOrganicWebhookService {
  private readonly logger = new Logger(SocialOrganicWebhookService.name);

  constructor(
    @InjectRepository(SocialOrganicWebhookEventEntity, 'agency')
    private readonly events: Repository<SocialOrganicWebhookEventEntity>,
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assets: Repository<SocialOrganicAssetEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /**
   * Persist one signature-verified delivery. Idempotent: a redelivery returns
   * the existing row's id with `duplicate: true` and writes nothing.
   */
  async ingest(
    input: SocialOrganicWebhookIngestInput,
  ): Promise<SocialOrganicWebhookIngestResult> {
    const scope = await this.resolveScope(input);

    try {
      const event = await this.events.save(
        this.events.create({
          provider: input.provider,
          eventKey: input.eventKey,
          objectType: input.objectType,
          externalAssetId: input.externalAssetId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          assetId: scope.assetId,
          scopeResolution: scope.scopeResolution,
          status: 'received',
          rawPayload: input.rawPayload,
        }),
      );

      return {
        eventId: event.id,
        duplicate: false,
        scopeResolution: scope.scopeResolution,
      };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      // The unique index — not this code — is what made the redelivery a
      // no-op. Reaching here means a concurrent or earlier delivery won.
      const existing = await this.events.findOne({
        where: { provider: input.provider, eventKey: input.eventKey },
      });
      if (!existing) throw error;

      return {
        eventId: existing.id,
        duplicate: true,
        scopeResolution: existing.scopeResolution,
      };
    }
  }

  /**
   * Scope is derived server-side from the provider's own asset id and nothing
   * else. Never from the payload's body fields, never from a query string,
   * never from a header — a webhook is an unauthenticated public request whose
   * only trustworthy claim is the one the HMAC covers.
   *
   * `social_organic_assets` is unique on
   * `(tenant_id, workspace_id, provider, external_asset_id)`, so one external
   * id **can** legitimately appear in more than one scope: two tenants may each
   * connect the same Page. That is the ambiguity case, and it fails closed —
   * guessing would deliver one tenant's data to another.
   *
   * Public because W1.2 resolves scope a second time, **per entry**: the
   * ingest path sees one delivery and can only scope a single-entry one, while
   * the worker splits a batch and each entry carries its own asset id. Sharing
   * this method is what keeps the two paths from drifting into two different
   * definitions of "resolved".
   */
  async resolveScope(input: {
    provider: string;
    externalAssetId: string | null;
  }): Promise<ResolvedWebhookScope> {
    const unresolved = (
      scopeResolution: SocialOrganicWebhookScopeResolution,
    ): ResolvedWebhookScope => ({
      scopeResolution,
      tenantId: null,
      workspaceId: null,
      agencyClientId: null,
      companyContextId: null,
      assetId: null,
    });

    if (!input.externalAssetId) {
      return unresolved('unresolved_no_asset_id');
    }

    // Two rows are enough to prove ambiguity; there is no reason to read more.
    const matches = await this.assets.find({
      where: {
        provider: input.provider,
        externalAssetId: input.externalAssetId,
      },
      select: {
        id: true,
        tenantId: true,
        workspaceId: true,
        agencyClientId: true,
        companyContextId: true,
      },
      take: 2,
    });

    if (matches.length === 0) return unresolved('unresolved_unknown_asset');
    if (matches.length > 1) return unresolved('unresolved_ambiguous');

    const [asset] = matches;
    return {
      scopeResolution: 'resolved',
      tenantId: asset.tenantId,
      workspaceId: asset.workspaceId,
      agencyClientId: asset.agencyClientId,
      companyContextId: asset.companyContextId,
      assetId: asset.id,
    };
  }

  /** Lease a batch of pending events for the worker. */
  async claim(input: {
    workerId: string;
    limit: number;
    now?: Date;
  }): Promise<SocialOrganicWebhookEventEntity[]> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.trunc(input.limit));

    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `SELECT id
           FROM social_organic_webhook_events
          WHERE status = 'received' AND available_at <= $1
          ORDER BY available_at, received_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [now, limit],
      );
      if (rows.length === 0) return [];

      const claimed = rows.map((row) => row.id);
      const updated: unknown = await manager.query(
        `UPDATE social_organic_webhook_events
            SET status = 'processing', locked_at = $2, locked_by = $3,
                attempts = attempts + 1, updated_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'received'
          RETURNING id`,
        [claimed, now, input.workerId],
      );
      return returnedRows<{ id: string }>(updated).map((row) => row.id);
    });

    return ids.length === 0
      ? []
      : this.events.find({ where: ids.map((id) => ({ id })) });
  }

  /**
   * Reclaim events whose worker died mid-processing. Unlike publishing, replay
   * here is harmless: W1.1's worker performs no external side effect, so a
   * reclaimed row is simply processed again.
   */
  async recoverStale(
    input: { now?: Date; leaseMs?: number } = {},
  ): Promise<{ requeued: number; deadLettered: number }> {
    const now = input.now ?? new Date();
    const expiredBefore = new Date(
      now.getTime() - (input.leaseMs ?? SOCIAL_ORGANIC_WEBHOOK_LEASE_MS),
    );

    const result: unknown = await this.dataSource.query(
      `UPDATE social_organic_webhook_events
          SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'received' END,
              available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE $2 END,
              processed_at = CASE WHEN attempts >= max_attempts THEN $2 ELSE processed_at END,
              locked_at = NULL, locked_by = NULL,
              safe_error_code = 'lease_expired', updated_at = now()
        WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < $1
        RETURNING status`,
      [expiredBefore, now],
    );

    const rows = returnedRows<{ status: string }>(result);
    const requeued = rows.filter((row) => row.status === 'received').length;
    const deadLettered = rows.length - requeued;
    if (rows.length > 0) {
      this.logger.warn(
        `Recovered stale organic webhook events: ${JSON.stringify({
          requeued,
          deadLettered,
        })}`,
      );
    }

    return { requeued, deadLettered };
  }

  /**
   * Settle one leased event. `lockedBy` is part of the WHERE clause so a worker
   * that lost its lease to the reaper cannot overwrite the row that another
   * worker now owns.
   */
  async settle(input: {
    eventId: string;
    lockedBy: string;
    status: Extract<
      SocialOrganicWebhookEventStatus,
      'processed' | 'unhandled' | 'failed'
    >;
    safeErrorCode?: string | null;
  }): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_organic_webhook_events
          SET status = $2, safe_error_code = $3, processed_at = now(),
              locked_at = NULL, locked_by = NULL, updated_at = now()
        WHERE id = $1 AND status = 'processing' AND locked_by = $4
        RETURNING id`,
      [
        input.eventId,
        input.status,
        input.safeErrorCode ?? null,
        input.lockedBy,
      ],
    );

    return returnedRows(result).length > 0;
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;

    return (
      (error.driverError as { code?: unknown } | undefined)?.code ===
      UNIQUE_VIOLATION
    );
  }
}
