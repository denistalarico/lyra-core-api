import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { formatScaledAmount } from '../../social-integrations/sync/metric-number';
import type { FormSubmissionSource } from '../forms.types';
import {
  AGENCY_REACHED_QUALIFIED_SQL,
  LEADFLOW_REACHED_QUALIFIED_SQL,
  leadflowScopeOf,
  listQualifiedStages,
} from '../crm-qualified-stages';
import {
  earnedConversions,
  type ConversionOpportunity,
} from '../google-ads-conversion.rules';

/**
 * AN-CRM (D-A1): the read port the Social Analytics uses for CRM figures.
 *
 * The Analytics never reads `form_submissions` nor a CRM table: it asks this
 * service, which answers aggregated facts per `provider + campaign + day` and
 * nothing that identifies a lead (no name, e-mail, phone, contact or
 * opportunity id leaves this class).
 *
 * Grain: a **lead cohort**. A fact's `day` is the day the lead arrived (the
 * provider's submission time, in the ad account's time zone), and `qualified`
 * / `won` count how many of that day's leads are qualified / won *now*. So
 * leads → qualified → won share one cohort and their rates are real; a sale
 * closed today for a lead of last month counts on last month's day.
 */

export type LeadFactsProvider = 'google_ads' | 'meta_ads';

/** The `form_submissions.source` each ad provider writes (D-L1). */
const PROVIDER_SOURCE: Record<LeadFactsProvider, FormSubmissionSource> = {
  google_ads: 'google_ads',
  meta_ads: 'meta_lead_ads',
};

export type LeadFactsScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
};

export type LeadFactsQuery = LeadFactsScope & {
  provider: LeadFactsProvider;
  /**
   * Keep only leads whose campaign is mirrored under this ad connection. The
   * caller has already proven the connection is in scope. `null` = every lead
   * of the provider in the scope (`connectionId` of the facts is then null).
   */
  connectionId: string | null;
  /** Inclusive days, `YYYY-MM-DD`, in `timezone`. */
  since: string;
  until: string;
  /** IANA zone of the ad account; anything else falls back to UTC. */
  timezone: string | null;
};

export type LeadFact = {
  provider: LeadFactsProvider;
  connectionId: string | null;
  /** Null when the lead named no campaign (or one this connection lacks). */
  campaignExternalId: string | null;
  day: string;
  /** Leads that reached a CRM, one per opportunity (duplicates attach). */
  leads: number;
  /** Null when no stage is classified as qualified (never 0 for "unknown"). */
  qualified: number | null;
  won: number;
  /** Sum of won opportunities' value, major units, 6 decimals. */
  wonValue: string;
};

export type LeadFactsResult = {
  /** False → no stage is classified as qualified; `qualified` is null everywhere. */
  qualifiedConfigured: boolean;
  facts: LeadFact[];
};

type CohortRow = {
  opportunityId: string;
  crm: string | null;
  campaignId: string | null;
  day: string;
};

type OpportunityRow = {
  id: string;
  status: string;
  pipelineId: string;
  reachedQualified: boolean | null;
  /** Integer cents, as text. */
  valueCents: string | null;
};

const TIMEZONE_PATTERN = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Cents → the 1e6 scale every Analytics amount uses. */
const CENTS_TO_SCALED = 10_000n;

@Injectable()
export class FormsLeadFactsReadService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async facts(query: LeadFactsQuery): Promise<LeadFactsResult> {
    if (!DAY_PATTERN.test(query.since) || !DAY_PATTERN.test(query.until))
      throw new Error('lead_facts_invalid_period');
    const qualifiedConfigured =
      (await listQualifiedStages(this.dataSource, query)).length > 0;

    let cohort = await this.cohort(query);
    if (query.connectionId) cohort = await this.ownCampaigns(query, cohort);
    if (cohort.length === 0) return { qualifiedConfigured, facts: [] };

    const opportunities = new Map<
      string,
      ConversionOpportunity & { cents: bigint }
    >();
    for (const crm of ['agency_sales', 'leadflow_crm'] as const) {
      const ids = cohort
        .filter((row) => row.crm === crm)
        .map((row) => row.opportunityId);
      for (const row of await this.opportunities(crm, query, ids))
        opportunities.set(`${crm}:${row.id}`, {
          crm,
          id: row.id,
          status: row.status,
          pipelineId: row.pipelineId,
          reachedQualified: row.reachedQualified === true,
          wonAt: null,
          valueAmount: null,
          currency: null,
          cents: toCents(row.valueCents),
        });
    }

    const buckets = new Map<
      string,
      {
        campaignId: string | null;
        day: string;
        leads: number;
        qualified: number;
        won: number;
        wonScaled: bigint;
      }
    >();
    for (const lead of cohort) {
      const key = `${lead.campaignId ?? ''}|${lead.day}`;
      const bucket = buckets.get(key) ?? {
        campaignId: lead.campaignId,
        day: lead.day,
        leads: 0,
        qualified: 0,
        won: 0,
        wonScaled: 0n,
      };
      bucket.leads += 1;
      // A deleted opportunity still entered the CRM, so it stays a lead; it
      // just cannot be qualified or won any more.
      const opportunity = opportunities.get(
        `${lead.crm}:${lead.opportunityId}`,
      );
      if (opportunity) {
        const earned = earnedConversions(opportunity);
        if (earned.includes('qualified')) bucket.qualified += 1;
        if (opportunity.status === 'won') {
          bucket.won += 1;
          bucket.wonScaled += opportunity.cents * CENTS_TO_SCALED;
        }
      }
      buckets.set(key, bucket);
    }

    const facts = [...buckets.values()]
      .sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          (a.campaignId ?? '').localeCompare(b.campaignId ?? ''),
      )
      .map(
        (bucket): LeadFact => ({
          provider: query.provider,
          connectionId: query.connectionId,
          campaignExternalId: bucket.campaignId,
          day: bucket.day,
          leads: bucket.leads,
          qualified: qualifiedConfigured ? bucket.qualified : null,
          won: bucket.won,
          wonValue: formatScaledAmount(bucket.wonScaled),
        }),
      );
    return { qualifiedConfigured, facts };
  }

  /**
   * The first ad-lead submission of each opportunity that reached a CRM and
   * arrived inside the period. First per opportunity, over all time, so a
   * duplicate attached today to last month's opportunity is not a new lead.
   */
  private async cohort(query: LeadFactsQuery): Promise<CohortRow[]> {
    const timezone =
      query.timezone && TIMEZONE_PATTERN.test(query.timezone)
        ? query.timezone
        : 'UTC';
    return this.dataSource.query<CohortRow[]>(
      `SELECT "opportunityId", "crm", "campaignId", "day"
         FROM (
           SELECT DISTINCT ON (s."opportunity_id")
                  s."opportunity_id" AS "opportunityId",
                  s."outcome"->>'opportunityTarget' AS "crm",
                  NULLIF(s."attribution"->>'campaignId', '') AS "campaignId",
                  to_char(a."arrivedAt" AT TIME ZONE $6, 'YYYY-MM-DD') AS "day"
             FROM "form_submissions" s
             CROSS JOIN LATERAL (
               SELECT CASE
                        WHEN s."attribution"->>'submittedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?Z$'
                        THEN (s."attribution"->>'submittedAt')::timestamptz
                        ELSE s."created_at"
                      END AS "arrivedAt"
             ) a
            WHERE s."tenant_id" = $1 AND s."workspace_id" = $2
              AND s."agency_client_id" IS NOT DISTINCT FROM $3::uuid
              AND s."company_context_id" IS NOT DISTINCT FROM $4::uuid
              AND s."source" = $5
              AND s."opportunity_id" IS NOT NULL
              AND COALESCE(s."attribution"->>'isTest', 'false') <> 'true'
            ORDER BY s."opportunity_id", a."arrivedAt", s."id"
         ) first
        WHERE "day" BETWEEN $7 AND $8`,
      [
        query.tenantId,
        query.workspaceId,
        query.agencyClientId,
        query.companyContextId,
        PROVIDER_SOURCE[query.provider],
        timezone,
        query.since,
        query.until,
      ],
    );
  }

  /** Same rule as the GA-CONV worker: a named campaign must be this connection's. */
  private async ownCampaigns(
    query: LeadFactsQuery,
    cohort: CohortRow[],
  ): Promise<CohortRow[]> {
    const named = [
      ...new Set(
        cohort.flatMap((row) => (row.campaignId ? [row.campaignId] : [])),
      ),
    ];
    if (named.length === 0) return [];
    const own = new Set(
      (
        await this.dataSource.query<Array<{ externalId: string }>>(
          `SELECT DISTINCT "external_id" AS "externalId"
             FROM "social_ad_entities"
            WHERE "tenant_id" = $1 AND "workspace_id" = $2
              AND "connection_id" = $3 AND "entity_level" = 'campaign'
              AND "external_id" = ANY($4::text[])`,
          [query.tenantId, query.workspaceId, query.connectionId, named],
        )
      ).map((row) => row.externalId),
    );
    return cohort.filter((row) => row.campaignId && own.has(row.campaignId));
  }

  /** State of the cohort's opportunities. Same columns the GA-CONV worker reads. */
  private async opportunities(
    crm: 'agency_sales' | 'leadflow_crm',
    scope: LeadFactsScope,
    ids: string[],
  ): Promise<OpportunityRow[]> {
    if (ids.length === 0) return [];
    if (crm === 'agency_sales')
      return this.dataSource.query<OpportunityRow[]>(
        `SELECT o."id", o."status", o."pipeline_id" AS "pipelineId",
                ${AGENCY_REACHED_QUALIFIED_SQL} AS "reachedQualified",
                o."amount_cents"::text AS "valueCents"
           FROM "agency_sales_opportunities" o
           LEFT JOIN "agency_sales_stages" s ON s."id" = o."stage_id"
          WHERE o."tenant_id" = $1 AND o."workspace_id" = $2 AND o."id" = ANY($3::uuid[])`,
        [scope.tenantId, scope.workspaceId, ids],
      );
    const leadflow = leadflowScopeOf(scope);
    return this.dataSource.query<OpportunityRow[]>(
      `SELECT o."id", o."status", o."pipeline_id" AS "pipelineId",
              ${LEADFLOW_REACHED_QUALIFIED_SQL} AS "reachedQualified",
              round(o."value_amount" * 100)::bigint::text AS "valueCents"
         FROM "crm_opportunities" o
         LEFT JOIN "crm_stages" s ON s."id" = o."stage_id"
        WHERE o."tenant_id" = $1 AND o."workspace_id" = $2
          AND o."agency_client_id" IS NOT DISTINCT FROM $3::uuid
          AND o."company_context_id" IS NOT DISTINCT FROM $4::uuid
          AND o."deleted_at" IS NULL AND o."id" = ANY($5::uuid[])`,
      [
        scope.tenantId,
        scope.workspaceId,
        leadflow.agencyClientId,
        leadflow.companyContextId,
        ids,
      ],
    );
  }
}

function toCents(value: string | null): bigint {
  if (value === null || !/^\d{1,18}$/.test(value)) return 0n;
  return BigInt(value);
}
