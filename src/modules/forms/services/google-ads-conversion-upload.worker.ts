import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { SocialAdCredentialError } from '../../social-integrations/credentials/social-ad-credential.error';
import { SocialAdCredentialResolver } from '../../social-integrations/credentials/social-ad-credential.resolver';
import type { ResolvedAdCredential } from '../../social-integrations/credentials/resolved-ad-credential';
import { GoogleAdsMutationClient } from '../../social-integrations/services/google-ads-mutation.client';
import {
  GoogleDataManagerClient,
  GoogleDataManagerError,
} from '../../social-integrations/services/google-data-manager.client';
import { SocialAdConnectionService } from '../../social-integrations/services/social-ad-connection.service';
import { GoogleAdsError } from '../../social-integrations/sync/google-ads-error';
import {
  GoogleAdsConversionUploadEntity,
  type GoogleAdsConversionCrm,
  type GoogleAdsConversionKind,
} from '../entities/google-ads-conversion-upload.entity';
import { GoogleAdsConversionUploadSettingsEntity } from '../entities/google-ads-conversion-upload-settings.entity';
import {
  type ConversionOpportunity,
  GCLID_MAX_AGE_DAYS,
  conversionActionIdOf,
  conversionMoment,
  conversionValueFor,
  customerIdOf,
  earnedConversions,
  nextAttemptAt,
  transactionIdFor,
} from '../google-ads-conversion.rules';
import {
  AGENCY_REACHED_QUALIFIED_SQL,
  LEADFLOW_REACHED_QUALIFIED_SQL,
  leadflowScopeOf,
} from '../crm-qualified-stages';
import {
  type GoogleAdsConversionScope,
  conversionUploadsAvailable,
} from './google-ads-conversion-upload.service';

const LOCK_KEY = 'google_ads_conversion_upload';
/** Per sweep: candidates read per connection and uploads sent in total. */
const CANDIDATE_LIMIT = 1000;
const SEND_LIMIT = 50;
/** `fields/v25/customer` (checked 2026-11-20): where conversions are owned. */
const CONVERSION_CUSTOMER_GAQL =
  'SELECT customer.id, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer';

type Candidate = {
  submissionId: string;
  opportunityId: string;
  gclid: string;
  campaignId: string | null;
  target: GoogleAdsConversionCrm;
  createdAt: Date;
};

/**
 * GA-CONV (D-G6, revised 2026-11-20): every 5 minutes, (1) finds Google-click
 * leads whose CRM deal reached a "qualified" stage or was won and queues one
 * row per `<opportunityId>:<kind>`, then (2) sends due rows to the Data
 * Manager API, one event per request, retrying up to 5 times.
 *
 * Neither CRM publishes an in-process event, so this reads state: a deal in,
 * or that passed through, a stage classified as qualified counts
 * (`crm-qualified-stages.ts`). Only ids, click ids and codes are logged or
 * stored.
 * Brake: `SOCIAL_GOOGLE_ADS_CONVERSION_UPLOAD_ENABLED`.
 */
@Injectable()
export class GoogleAdsConversionUploadWorker {
  private readonly logger = new Logger(GoogleAdsConversionUploadWorker.name);

  constructor(
    @InjectRepository(GoogleAdsConversionUploadSettingsEntity, 'agency')
    private readonly settings: Repository<GoogleAdsConversionUploadSettingsEntity>,
    @InjectRepository(GoogleAdsConversionUploadEntity, 'agency')
    private readonly uploads: Repository<GoogleAdsConversionUploadEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly connections: SocialAdConnectionService,
    private readonly credentials: SocialAdCredentialResolver,
    private readonly googleAds: GoogleAdsMutationClient,
    private readonly dataManager: GoogleDataManagerClient,
  ) {}

  @Cron('0 */5 * * * *', {
    name: 'google-ads-conversion-upload',
    waitForCompletion: true,
  })
  async sweep(now: Date = new Date()): Promise<void> {
    if (!conversionUploadsAvailable()) return;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [LOCK_KEY],
      )) as Array<{ locked: boolean }>;
      if (!locked) return;
      try {
        await this.run(now);
      } finally {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [LOCK_KEY],
        );
      }
    } finally {
      await runner.release();
    }
  }

  async run(now: Date): Promise<void> {
    const enabled = await this.settings.find({ where: { enabled: true } });
    if (enabled.length === 0) return;
    const live = new Map(
      (await this.connections.listSchedulable(['google_ads'])).map((c) => [
        c.connectionId,
        c,
      ]),
    );
    const active = new Map<string, GoogleAdsConversionUploadSettingsEntity>();
    for (const row of enabled) {
      const connection = live.get(row.connectionId);
      // Disconnected, or the settings row no longer matches the connection scope.
      if (
        !connection ||
        connection.tenantId !== row.tenantId ||
        connection.workspaceId !== row.workspaceId ||
        (connection.agencyClientId ?? null) !== row.agencyClientId ||
        (connection.companyContextId ?? null) !== row.companyContextId
      )
        continue;
      active.set(row.connectionId, row);
      try {
        const queued = await this.detect(row, now);
        if (queued > 0)
          this.logger.log(
            `Google Ads conversions queued for connection ${row.connectionId}: ${queued}.`,
          );
      } catch (error) {
        this.logger.warn(
          `Google Ads conversion detection failed for connection ${row.connectionId} (${errorName(error)}).`,
        );
      }
    }
    await this.send(active, now);
  }

  /** Queues what the connection's leads have earned. Returns rows inserted. */
  async detect(
    settings: GoogleAdsConversionUploadSettingsEntity,
    now: Date,
  ): Promise<number> {
    if (!settings.qualifiedActionResource && !settings.wonActionResource)
      return 0;
    const scope: GoogleAdsConversionScope = {
      tenantId: settings.tenantId,
      workspaceId: settings.workspaceId,
      agencyClientId: settings.agencyClientId,
      companyContextId: settings.companyContextId,
    };
    const since = new Date(now.getTime() - GCLID_MAX_AGE_DAYS * 86_400_000);
    let candidates = await this.candidates(scope, since);
    if (candidates.length === 0) return 0;

    candidates = await this.ownCampaignsOnly(settings.connectionId, candidates);
    const existing = new Set(
      (
        await this.uploads.find({
          select: { transactionId: true },
          where: {
            connectionId: settings.connectionId,
            opportunityId: In(candidates.map((c) => c.opportunityId)),
          },
        })
      ).map((row) => row.transactionId),
    );

    const opportunities = new Map<string, ConversionOpportunity>();
    for (const crm of ['agency_sales', 'leadflow_crm'] as const) {
      const ids = candidates
        .filter((c) => c.target === crm)
        .map((c) => c.opportunityId);
      for (const opportunity of await this.opportunities(crm, scope, ids))
        opportunities.set(`${crm}:${opportunity.id}`, opportunity);
    }

    const rows: Array<Partial<GoogleAdsConversionUploadEntity>> = [];
    for (const candidate of candidates) {
      const opportunity = opportunities.get(
        `${candidate.target}:${candidate.opportunityId}`,
      );
      if (!opportunity) continue;
      for (const kind of earnedConversions(opportunity)) {
        const action = this.actionFor(settings, kind);
        const transactionId = transactionIdFor(opportunity.id, kind);
        if (!action || existing.has(transactionId)) continue;
        const { value, currency } = conversionValueFor(
          kind,
          opportunity,
          settings.sendValue,
        );
        rows.push({
          tenantId: settings.tenantId,
          workspaceId: settings.workspaceId,
          agencyClientId: settings.agencyClientId,
          companyContextId: settings.companyContextId,
          connectionId: settings.connectionId,
          crm: candidate.target,
          opportunityId: opportunity.id,
          kind,
          transactionId,
          formSubmissionId: candidate.submissionId,
          gclid: candidate.gclid,
          conversionAction: action,
          conversionAt: conversionMoment(
            kind,
            opportunity,
            candidate.createdAt,
            now,
          ),
          conversionValue: value === null ? null : value.toFixed(2),
          currencyCode: currency,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
        });
      }
    }
    if (rows.length === 0) return 0;
    const result = await this.uploads
      .createQueryBuilder()
      .insert()
      .into(GoogleAdsConversionUploadEntity)
      .values(rows)
      .orIgnore()
      .execute();
    return result.identifiers.filter(Boolean).length;
  }

  /** Sends due rows of enabled connections; one event per Data Manager call. */
  async send(
    active: ReadonlyMap<string, GoogleAdsConversionUploadSettingsEntity>,
    now: Date,
  ): Promise<void> {
    if (active.size === 0) return;
    const due = await this.uploads.find({
      where: {
        status: 'pending',
        nextAttemptAt: LessThanOrEqual(now),
        connectionId: In([...active.keys()]),
      },
      order: { nextAttemptAt: 'ASC' },
      take: SEND_LIMIT,
    });
    const byConnection = new Map<string, GoogleAdsConversionUploadEntity[]>();
    for (const row of due)
      byConnection.set(row.connectionId, [
        ...(byConnection.get(row.connectionId) ?? []),
        row,
      ]);

    for (const [connectionId, rows] of byConnection) {
      const first = rows[0];
      let credential: ResolvedAdCredential;
      let conversionCustomerId: string;
      try {
        credential = await this.credentials.resolve({
          connectionId,
          tenantId: first.tenantId,
          workspaceId: first.workspaceId,
          agencyClientId: first.agencyClientId,
          companyContextId: first.companyContextId,
        });
        conversionCustomerId = await this.conversionCustomer(credential);
      } catch (error) {
        const failure = classify(error);
        for (const row of rows) await this.fail(row, failure, now);
        continue;
      }

      for (const row of rows) {
        const actionId = conversionActionIdOf(row.conversionAction);
        if (!actionId) {
          await this.fail(
            row,
            { retry: false, code: 'conversion_action_invalid' },
            now,
          );
          continue;
        }
        try {
          const { requestId } = await this.dataManager.ingestClickConversion(
            credential,
            {
              conversionCustomerId,
              conversionActionId: actionId,
              gclid: row.gclid,
              eventAt: row.conversionAt,
              transactionId: row.transactionId,
              value:
                row.conversionValue === null
                  ? null
                  : Number(row.conversionValue),
              currency: row.currencyCode,
            },
            { validateOnly: false },
          );
          row.attempts += 1;
          row.status = 'uploaded';
          row.uploadedAt = now;
          row.requestId = requestId;
          row.errorCode = null;
          await this.uploads.save(row);
        } catch (error) {
          await this.fail(row, classify(error), now);
        }
      }
    }
  }

  private async fail(
    row: GoogleAdsConversionUploadEntity,
    failure: { retry: boolean; code: string },
    now: Date,
  ) {
    row.attempts += 1;
    row.errorCode = failure.code.slice(0, 120);
    const next = failure.retry ? nextAttemptAt(row.attempts, now) : null;
    if (next) row.nextAttemptAt = next;
    else row.status = 'failed';
    await this.uploads.save(row);
    this.logger.warn(
      `Google Ads conversion ${row.id} ${row.status === 'failed' ? 'failed' : 'will retry'} (${row.errorCode}, attempt ${row.attempts}).`,
    );
  }

  /** The account's conversion customer, or the account itself (1 operation). */
  private async conversionCustomer(
    credential: ResolvedAdCredential,
  ): Promise<string> {
    const [row] = await this.googleAds.search(
      credential,
      CONVERSION_CUSTOMER_GAQL,
    );
    const customer =
      typeof row?.customer === 'object' && row.customer !== null
        ? (row.customer as Record<string, unknown>)
        : {};
    const setting =
      typeof customer.conversionTrackingSetting === 'object' &&
      customer.conversionTrackingSetting !== null
        ? (customer.conversionTrackingSetting as Record<string, unknown>)
        : {};
    return (
      customerIdOf(setting.googleAdsConversionCustomer) ??
      credential.externalAccountId
    );
  }

  private actionFor(
    settings: GoogleAdsConversionUploadSettingsEntity,
    kind: GoogleAdsConversionKind,
  ): string | null {
    return kind === 'won'
      ? settings.wonActionResource
      : settings.qualifiedActionResource;
  }

  /** Latest Google-click submission per deal, same scope as the connection. */
  private async candidates(
    scope: GoogleAdsConversionScope,
    since: Date,
  ): Promise<Candidate[]> {
    const rows = await this.dataSource.query<
      Array<{
        submissionId: string;
        opportunityId: string;
        gclid: string;
        campaignId: string | null;
        target: string | null;
        createdAt: Date;
      }>
    >(
      `SELECT DISTINCT ON ("opportunity_id")
              "id" AS "submissionId", "opportunity_id" AS "opportunityId",
              "attribution"->>'gclid' AS "gclid", "attribution"->>'campaignId' AS "campaignId",
              "outcome"->>'opportunityTarget' AS "target", "created_at" AS "createdAt"
         FROM "form_submissions"
        WHERE "tenant_id" = $1 AND "workspace_id" = $2
          AND "agency_client_id" IS NOT DISTINCT FROM $3::uuid
          AND "company_context_id" IS NOT DISTINCT FROM $4::uuid
          AND "opportunity_id" IS NOT NULL
          AND length("attribution"->>'gclid') BETWEEN 1 AND 200
          AND COALESCE("attribution"->>'isTest', 'false') <> 'true'
          AND "created_at" >= $5
        ORDER BY "opportunity_id", "created_at" DESC
        LIMIT ${CANDIDATE_LIMIT}`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
        since,
      ],
    );
    return rows.flatMap((row) =>
      row.target === 'agency_sales' || row.target === 'leadflow_crm'
        ? [{ ...row, target: row.target, createdAt: new Date(row.createdAt) }]
        : [],
    );
  }

  /**
   * A lead that names its campaign must name one of this connection's
   * campaigns (two Google accounts in one scope must not get each other's
   * clicks). A site form with a `gclid` and no campaign passes on scope.
   */
  private async ownCampaignsOnly(
    connectionId: string,
    candidates: Candidate[],
  ): Promise<Candidate[]> {
    const named = [
      ...new Set(
        candidates.flatMap((c) => (c.campaignId ? [c.campaignId] : [])),
      ),
    ];
    if (named.length === 0) return candidates;
    const own = new Set(
      (
        await this.dataSource.query<Array<{ externalId: string }>>(
          `SELECT DISTINCT "external_id" AS "externalId"
             FROM "social_ad_entities"
            WHERE "connection_id" = $1 AND "entity_level" = 'campaign'
              AND "external_id" = ANY($2::text[])`,
          [connectionId, named],
        )
      ).map((row) => row.externalId),
    );
    return candidates.filter((c) => !c.campaignId || own.has(c.campaignId));
  }

  private async opportunities(
    crm: GoogleAdsConversionCrm,
    scope: GoogleAdsConversionScope,
    ids: string[],
  ): Promise<ConversionOpportunity[]> {
    if (ids.length === 0) return [];
    type Row = {
      id: string;
      status: string;
      pipelineId: string;
      reachedQualified: boolean | null;
      wonAt: Date | null;
      valueAmount: string | number | null;
      currency: string | null;
    };
    const rows =
      crm === 'agency_sales'
        ? await this.dataSource.query<Row[]>(
            `SELECT o."id", o."status", o."pipeline_id" AS "pipelineId",
                    ${AGENCY_REACHED_QUALIFIED_SQL} AS "reachedQualified",
                    o."closed_at" AS "wonAt", o."amount_cents" / 100.0 AS "valueAmount",
                    o."currency"
               FROM "agency_sales_opportunities" o
               LEFT JOIN "agency_sales_stages" s ON s."id" = o."stage_id"
              WHERE o."tenant_id" = $1 AND o."workspace_id" = $2 AND o."id" = ANY($3::uuid[])`,
            [scope.tenantId, scope.workspaceId, ids],
          )
        : await this.dataSource.query<Row[]>(
            `SELECT o."id", o."status", o."pipeline_id" AS "pipelineId",
                    ${LEADFLOW_REACHED_QUALIFIED_SQL} AS "reachedQualified",
                    o."won_at" AS "wonAt", o."value_amount" AS "valueAmount", o."currency"
               FROM "crm_opportunities" o
               LEFT JOIN "crm_stages" s ON s."id" = o."stage_id"
              WHERE o."tenant_id" = $1 AND o."workspace_id" = $2
                AND o."agency_client_id" IS NOT DISTINCT FROM $3::uuid
                AND o."company_context_id" IS NOT DISTINCT FROM $4::uuid
                AND o."deleted_at" IS NULL AND o."id" = ANY($5::uuid[])`,
            [
              scope.tenantId,
              scope.workspaceId,
              leadflowScopeOf(scope).agencyClientId,
              leadflowScopeOf(scope).companyContextId,
              ids,
            ],
          );
    return rows.map((row) => ({
      crm,
      id: row.id,
      status: row.status,
      pipelineId: row.pipelineId,
      reachedQualified: row.reachedQualified === true,
      wonAt: row.wonAt ? new Date(row.wonAt) : null,
      valueAmount: row.valueAmount === null ? null : Number(row.valueAmount),
      currency: row.currency,
    }));
  }
}

/** Retry what time or a reconnection can fix; give up on refusals. */
function classify(error: unknown): { retry: boolean; code: string } {
  if (error instanceof GoogleDataManagerError)
    return {
      retry: error.kind !== 'permanent',
      code: error.reason ? `${error.code}:${error.reason}` : error.code,
    };
  if (error instanceof SocialAdCredentialError)
    return { retry: error.code !== 'connection_not_found', code: error.code };
  if (error instanceof GoogleAdsError)
    return { retry: error.kind !== 'permanent', code: error.code };
  return { retry: true, code: errorName(error) };
}

function errorName(error: unknown): string {
  if (error instanceof GoogleAdsError) return error.code;
  if (error instanceof SocialAdCredentialError) return error.code;
  return error instanceof Error ? error.name : 'UnknownError';
}
