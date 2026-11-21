import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  SocialAnalyticsCrmCampaignRow,
  SocialAnalyticsCrmSeriesPoint,
  SocialAnalyticsCrmTotals,
  SocialAnalyticsCrmView,
} from '../../../common/analytics-contracts/social-analytics.types';
import {
  deriveChange,
  divideScaled,
  formatDerived,
} from '../../social-integrations/analytics/social-ad-kpi';
import {
  parseAnalyticsPeriod,
  previousAnalyticsPeriod,
  type SocialAdAnalyticsPeriod,
} from '../../social-integrations/analytics/social-ad-analytics-period';
import { SocialAnalyticsReadService } from '../../social-integrations/services/social-analytics-read.service';
import { shiftDay } from '../../social-integrations/sync/insights-window';
import {
  formatScaledAmount,
  parseScaledAmount,
} from '../../social-integrations/sync/metric-number';
import {
  FormsLeadFactsReadService,
  type LeadFact,
  type LeadFactsProvider,
  type LeadFactsScope,
} from './forms-lead-facts.read.service';

export type {
  SocialAnalyticsCrmCampaignRow,
  SocialAnalyticsCrmSeriesPoint,
  SocialAnalyticsCrmTotals,
  SocialAnalyticsCrmView,
} from '../../../common/analytics-contracts/social-analytics.types';

type Sums = {
  leads: bigint;
  qualified: bigint | null;
  won: bigint;
  /** Scaled to 1e6. */
  wonValue: bigint;
};

const SCALE = 1_000_000n;
const PERCENT_BASIS = 100n;

/**
 * AN-CRM (D-A1, §6.2): "Leads e vendas" for one ad connection, served from the
 * Forms module (which already imports the Social read model; the reverse
 * import would be a cycle). The CRM side comes only from the
 * `FormsLeadFactsReadService` port and the spend only from
 * `SocialAnalyticsReadService`, so neither the Analytics nor this class reads
 * `form_submissions` or a CRM table, and no provider is called.
 *
 * Every quotient is derived here, from two sums, with the shared KPI
 * utility (D-A2): nothing is stored.
 */
@Injectable()
export class SocialAnalyticsCrmReadService {
  constructor(
    private readonly analytics: SocialAnalyticsReadService,
    private readonly leadFacts: FormsLeadFactsReadService,
  ) {}

  async read(
    input: LeadFactsScope & {
      connectionId: string;
      since: unknown;
      until: unknown;
    },
  ): Promise<SocialAnalyticsCrmView> {
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });
    const comparison = previousAnalyticsPeriod(period);
    const scope: LeadFactsScope = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId ?? null,
      companyContextId: input.companyContextId ?? null,
    };

    // The scope check: a connection of another client is simply not listed.
    const connection = (await this.analytics.listConnections(scope)).find(
      (item) => item.id === input.connectionId,
    );
    if (!connection) throw new NotFoundException('connection_not_found');
    if (
      connection.provider !== 'google_ads' &&
      connection.provider !== 'meta_ads'
    )
      throw new UnprocessableEntityException('crm_facts_unsupported_provider');
    const provider: LeadFactsProvider = connection.provider;

    const readInput = { ...scope, connectionId: connection.id };
    const [overview, campaigns, current, previous] = await Promise.all([
      this.analytics.overview({
        ...readInput,
        since: period.since,
        until: period.until,
      }),
      this.analytics.campaigns({
        ...readInput,
        since: period.since,
        until: period.until,
      }),
      this.leadFacts.facts({
        ...scope,
        provider,
        connectionId: connection.id,
        since: period.since,
        until: period.until,
        timezone: connection.timezone,
      }),
      this.leadFacts.facts({
        ...scope,
        provider,
        connectionId: connection.id,
        since: comparison.since,
        until: comparison.until,
        timezone: connection.timezone,
      }),
    ]);

    const configured = current.qualifiedConfigured;
    const now = sum(current.facts, configured);
    const before = sum(previous.facts, configured);

    return {
      connectionId: connection.id,
      provider,
      timezone: overview.timezone,
      currency: overview.currency,
      period: { since: period.since, until: period.until },
      comparisonPeriod: { since: comparison.since, until: comparison.until },
      qualifiedConfigured: configured,
      current: totals(now, scaled(overview.current.spend)),
      previous: totals(before, scaled(overview.previous.spend)),
      change: {
        leads: deriveChange(now.leads * SCALE, before.leads * SCALE),
        qualified:
          now.qualified === null || before.qualified === null
            ? null
            : deriveChange(now.qualified * SCALE, before.qualified * SCALE),
        won: deriveChange(now.won * SCALE, before.won * SCALE),
        wonValue: deriveChange(now.wonValue, before.wonValue),
      },
      series: series(period, current.facts, configured),
      campaigns: byCampaign(current.facts, campaigns.items, configured),
    };
  }
}

function scaled(value: string | null | undefined): bigint {
  return parseScaledAmount(value) ?? 0n;
}

function sum(facts: LeadFact[], configured: boolean): Sums {
  const sums: Sums = {
    leads: 0n,
    qualified: configured ? 0n : null,
    won: 0n,
    wonValue: 0n,
  };
  for (const fact of facts) {
    sums.leads += BigInt(fact.leads);
    if (sums.qualified !== null) sums.qualified += BigInt(fact.qualified ?? 0);
    sums.won += BigInt(fact.won);
    sums.wonValue += scaled(fact.wonValue);
  }
  return sums;
}

function totals(sums: Sums, spend: bigint): SocialAnalyticsCrmTotals {
  return {
    leads: sums.leads.toString(),
    qualified: sums.qualified === null ? null : sums.qualified.toString(),
    won: sums.won.toString(),
    wonValue: formatScaledAmount(sums.wonValue),
    spend: formatScaledAmount(spend),
    // Money over a whole count: the count meets the amount's scale.
    costPerLead: formatDerived(divideScaled(spend, sums.leads * SCALE)),
    costPerQualified:
      sums.qualified === null
        ? null
        : formatDerived(divideScaled(spend, sums.qualified * SCALE)),
    realRoas: formatDerived(divideScaled(sums.wonValue, spend)),
    leadToSaleRate: formatDerived(
      divideScaled(sums.won * PERCENT_BASIS, sums.leads),
    ),
  };
}

function series(
  period: SocialAdAnalyticsPeriod,
  facts: LeadFact[],
  configured: boolean,
): SocialAnalyticsCrmSeriesPoint[] {
  const byDay = new Map<string, LeadFact[]>();
  for (const fact of facts)
    byDay.set(fact.day, [...(byDay.get(fact.day) ?? []), fact]);
  const points: SocialAnalyticsCrmSeriesPoint[] = [];
  for (let index = 0; index < period.days; index += 1) {
    const date = shiftDay(period.since, index);
    const day = sum(byDay.get(date) ?? [], configured);
    points.push({
      date,
      leads: day.leads.toString(),
      qualified: day.qualified === null ? null : day.qualified.toString(),
      won: day.won.toString(),
      wonValue: formatScaledAmount(day.wonValue),
    });
  }
  return points;
}

function byCampaign(
  facts: LeadFact[],
  campaigns: Array<{ externalId: string; name: string | null; spend: string }>,
  configured: boolean,
): SocialAnalyticsCrmCampaignRow[] {
  const grouped = new Map<string, LeadFact[]>();
  for (const fact of facts) {
    if (!fact.campaignExternalId) continue;
    grouped.set(fact.campaignExternalId, [
      ...(grouped.get(fact.campaignExternalId) ?? []),
      fact,
    ]);
  }
  const spendRows = new Map(campaigns.map((row) => [row.externalId, row]));
  const ids = new Set([...spendRows.keys(), ...grouped.keys()]);
  const rows = [...ids].map((id) => {
    const spendRow = spendRows.get(id);
    const spend = scaled(spendRow?.spend);
    const sums = sum(grouped.get(id) ?? [], configured);
    return {
      campaignExternalId: id,
      name: spendRow?.name ?? null,
      ...totals(sums, spend),
      order: { leads: sums.leads, spend },
    };
  });
  rows.sort((a, b) =>
    a.order.leads !== b.order.leads
      ? a.order.leads > b.order.leads
        ? -1
        : 1
      : a.order.spend !== b.order.spend
        ? a.order.spend > b.order.spend
          ? -1
          : 1
        : a.campaignExternalId.localeCompare(b.campaignExternalId),
  );
  return rows.map((row) => {
    const { order, ...view } = row;
    void order;
    return view;
  });
}
