import { Injectable } from '@nestjs/common';
import { SocialAnalyticsReadService } from '../../social-integrations/services/social-analytics-read.service';
import type { SocialAdAnalyticsOverviewView } from '../../social-integrations/views/social-ad-analytics-overview.view';
import { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';
import type { SocialOrganicAnalyticsOverviewView } from './views/social-organic-analytics-overview.view';

export type SocialConsolidatedAnalyticsScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
};

export type SocialConsolidatedOverviewInput =
  SocialConsolidatedAnalyticsScope & {
    paidConnectionId: string;
    organicAssetId: string;
    since: string;
    until: string;
  };

export type SocialConsolidatedAnalyticsOverviewView = {
  period: { since: string; until: string };
  paid: {
    connectionId: string;
    timezone: string;
    currency: string | null;
    totals: SocialAdAnalyticsOverviewView['current'];
    hasPartialData: boolean;
    lastFactDate: string | null;
  };
  organic: {
    assetId: string;
    timezone: string;
    totals: SocialOrganicAnalyticsOverviewView['totals'];
    hasPartialData: boolean;
    lastFactDate: string | null;
  };
};

/**
 * A4: paid and organic side by side for the same period.
 *
 * ADR-010 (blueprint §15.4) is the rule this class exists to enforce:
 * "Paid and organic are joined at read time, never summed... a sum of paid +
 * organic impressions means nothing." Both halves pass through their own
 * read service's `overview()` unchanged — `Promise.all` and a pure merge,
 * with no arithmetic across the two results anywhere in this file. There is
 * no `combined`/`total`/`all`/`sum` field in the response, and that absence
 * is the deliverable (enforced by test).
 *
 * The constructor accepts only the two read services — no direct repository
 * or DataSource access to either fact table is even possible given this
 * type signature, so a future edit cannot quietly add a cross-domain sum
 * without first widening this class's dependencies in a way a reviewer
 * would see.
 */
@Injectable()
export class SocialConsolidatedAnalyticsService {
  constructor(
    private readonly paidReads: SocialAnalyticsReadService,
    private readonly organicReads: SocialOrganicAnalyticsReadService,
  ) {}

  async overview(
    input: SocialConsolidatedOverviewInput,
  ): Promise<SocialConsolidatedAnalyticsOverviewView> {
    // One scope object, spread identically into both calls — not two
    // independently built scopes that could silently diverge.
    const scope: SocialConsolidatedAnalyticsScope = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId,
    };

    const [paid, organic] = await Promise.all([
      this.paidReads.overview({
        ...scope,
        connectionId: input.paidConnectionId,
        since: input.since,
        until: input.until,
      }),
      this.organicReads.overview({
        ...scope,
        assetId: input.organicAssetId,
        since: input.since,
        until: input.until,
      }),
    ]);

    return {
      period: { since: input.since, until: input.until },
      paid: {
        connectionId: paid.connectionId,
        // Surfaced independently per side, never assumed equal — paid and
        // organic can legitimately run in different timezones/currencies.
        timezone: paid.timezone,
        currency: paid.currency,
        totals: paid.current,
        hasPartialData: paid.hasPartialData,
        lastFactDate: paid.lastFactDate,
      },
      organic: {
        assetId: organic.assetId,
        timezone: organic.timezone,
        totals: organic.totals,
        hasPartialData: organic.hasPartialData,
        lastFactDate: organic.lastFactDate,
      },
    };
  }
}
