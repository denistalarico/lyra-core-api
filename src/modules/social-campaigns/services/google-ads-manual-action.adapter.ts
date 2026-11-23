import { Injectable } from '@nestjs/common';
import {
  SocialAdCredentialResolver,
  type ResolvedAdCredential,
} from '../../social-integrations';
import {
  GoogleAdsMutationClient,
  type GoogleAdsMutateResource,
} from '../../social-integrations/services/google-ads-mutation.client';
import type { GoogleAdsRawRow } from '../../social-integrations/services/google-ads-reader.service';
import type { SocialAdManualActionType } from '../entities';
import type { SocialCampaignsScope } from './social-boost-template.service';

/** What a Google object is, read from the mirror (D-G1: asset groups are `adset`). */
export type GoogleAdTarget = {
  kind: 'campaign' | 'ad_group' | 'asset_group' | 'ad_group_ad';
  id: string;
  /** The ad group of an `ad_group_ad`; null otherwise. */
  adGroupId: string | null;
};

export type GoogleAdBudgetState = {
  resourceName: string;
  amountMinor: string | null;
  period: string | null;
  shared: boolean;
};

/**
 * The live state one action depends on. `status` is Google's own enum
 * (`ENABLED`/`PAUSED`/`REMOVED`); `criterionResourceName` is the matching
 * keyword, negative keyword or search theme, or null when there is none.
 */
export type GoogleAdWritableState = {
  status: string | null;
  budget: GoogleAdBudgetState | null;
  criterionResourceName: string | null;
};

/** One row of the campaign keyword panel; metrics are null where Google has none. */
export type GoogleKeywordListItem = {
  kind: 'keyword' | 'search_theme';
  groupId: string;
  groupName: string | null;
  text: string;
  matchType: string | null;
  status: 'ENABLED' | 'PAUSED' | null;
  impressions: string | null;
  clicks: string | null;
  interactions: string | null;
  conversions: string | null;
};

export class GoogleAdManualActionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type GoogleAdActionInput = SocialCampaignsScope & {
  connectionId: string;
  actionType: SocialAdManualActionType;
  target: GoogleAdTarget;
  change: Record<string, unknown>;
};

type WithExpected = GoogleAdActionInput & { expected: GoogleAdWritableState };

const ID = /^\d{1,20}$/;
const BUDGET_RESOURCE = /^customers\/\d{1,20}\/campaignBudgets\/\d{1,20}$/;
const CRITERION_RESOURCE =
  /^customers\/\d{1,20}\/(campaignCriteria|adGroupCriteria|assetGroupSignals)\/\d{1,20}~\d{1,20}$/;
const MICROS_PER_MINOR = 10_000n;

const STATUS_RESOURCE: Record<GoogleAdTarget['kind'], GoogleAdsMutateResource> =
  {
    campaign: 'campaigns',
    ad_group: 'adGroups',
    asset_group: 'assetGroups',
    ad_group_ad: 'adGroupAds',
  };

/** Case and spacing do not make two keywords different for Google. */
export function normalizeGoogleKeywordText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The only GA-WRITE component that turns a confirmed intent into a Google Ads
 * write (D-G5). Sibling of the Meta adapter: re-reads live state, refuses when
 * it moved since the preflight, writes, then reads back. The preflight runs the
 * same mutation with `validateOnly`, so Google checks it without applying it.
 *
 * Keyword text is never interpolated into GAQL: lists are read by parent
 * resource (ids only) and matched here.
 */
@Injectable()
export class GoogleAdsManualActionAdapter {
  constructor(
    private readonly credentials: SocialAdCredentialResolver,
    private readonly client: GoogleAdsMutationClient,
  ) {}

  /** Preflight read: one operation. */
  async inspect(input: GoogleAdActionInput): Promise<GoogleAdWritableState> {
    const credential = await this.resolve(input);
    return this.readState(credential, input);
  }

  /** Preflight check by Google itself: one operation, nothing applied. */
  async validate(input: WithExpected): Promise<void> {
    const credential = await this.resolve(input);
    const mutation = this.toMutation(credential, input, input.expected);
    await this.client.mutate(
      credential,
      mutation.resource,
      mutation.operations,
      {
        validateOnly: true,
      },
    );
  }

  async execute(input: WithExpected) {
    const credential = await this.resolve(input);
    const current = await this.readState(credential, input);
    if (!this.matchesExpected(current, input.expected, input.actionType)) {
      throw new GoogleAdManualActionError('provider_state_changed');
    }

    const mutation = this.toMutation(credential, input, current);
    await this.client.mutate(
      credential,
      mutation.resource,
      mutation.operations,
      {
        validateOnly: false,
      },
    );

    try {
      const after = await this.readState(credential, input);
      return {
        before: current,
        after,
        providerAccepted: true,
        verified: this.matchesChange(after, input),
      };
    } catch {
      // Accepted but not read back: not safe to retry blindly. The audit row
      // says accepted/unverified and the next sync settles the mirror.
      return {
        before: current,
        after: null,
        providerAccepted: true,
        verified: false,
      };
    }
  }

  /**
   * The keyword panel of one campaign, read live when the operator opens it
   * (the mirror holds no keyword inventory). Search: ad-group keywords with
   * status and period metrics from `keyword_view`. Performance Max: the search
   * themes of each asset group (Google reports no metrics or status there).
   * Ids and dates are validated before they reach GAQL.
   */
  async listKeywords(
    input: SocialCampaignsScope & {
      connectionId: string;
      campaignId: string;
      channelType: string | null;
      groups: Array<{
        id: string;
        name: string | null;
        kind: 'ad_group' | 'asset_group';
      }>;
      since: string;
      until: string;
    },
  ): Promise<GoogleKeywordListItem[]> {
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (
      !ID.test(input.campaignId) ||
      !DAY.test(input.since) ||
      !DAY.test(input.until)
    ) {
      throw new GoogleAdManualActionError('google_object_not_found');
    }
    const credential = await this.credentials.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      connectionId: input.connectionId,
    });
    const customer = credential.externalAccountId;
    const names = new Map(input.groups.map((group) => [group.id, group.name]));

    if (input.channelType === 'PERFORMANCE_MAX') {
      const items: GoogleKeywordListItem[] = [];
      for (const group of input.groups) {
        if (group.kind !== 'asset_group' || !ID.test(group.id)) continue;
        const rows = await this.client.search(
          credential,
          `SELECT asset_group_signal.resource_name, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group_signal.asset_group = 'customers/${customer}/assetGroups/${group.id}'`,
        );
        for (const row of rows) {
          const theme = this.record(
            this.record(row.assetGroupSignal).searchTheme,
          );
          if (typeof theme.text !== 'string' || !theme.text.trim()) continue;
          items.push({
            kind: 'search_theme',
            groupId: group.id,
            groupName: group.name,
            text: normalizeGoogleKeywordText(theme.text),
            matchType: null,
            status: null,
            impressions: null,
            clicks: null,
            interactions: null,
            conversions: null,
          });
        }
      }
      return items;
    }

    if (input.channelType !== 'SEARCH') return [];

    const [criteria, metrics] = await Promise.all([
      this.client.search(
        credential,
        `SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE campaign.id = ${input.campaignId} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'`,
      ),
      this.client.search(
        credential,
        `SELECT ad_group.id, ad_group_criterion.criterion_id, metrics.impressions, metrics.clicks, metrics.interactions, metrics.conversions FROM keyword_view WHERE campaign.id = ${input.campaignId} AND segments.date BETWEEN '${input.since}' AND '${input.until}'`,
      ),
    ]);
    const measured = new Map<string, Record<string, unknown>>();
    for (const row of metrics) {
      const key = `${this.scalar(this.record(row.adGroup).id)}~${this.scalar(this.record(row.adGroupCriterion).criterionId)}`;
      measured.set(key, this.record(row.metrics));
    }
    return criteria.flatMap((row): GoogleKeywordListItem[] => {
      const groupId = this.scalar(this.record(row.adGroup).id);
      const criterion = this.record(row.adGroupCriterion);
      const keyword = this.record(criterion.keyword);
      if (typeof keyword.text !== 'string') return [];
      const values =
        measured.get(`${groupId}~${this.scalar(criterion.criterionId)}`) ?? {};
      // keyword_view omits keywords without activity in the period: zero.
      const metric = (name: string) => this.scalar(values[name]) || '0';
      return [
        {
          kind: 'keyword',
          groupId,
          groupName: names.get(groupId) ?? null,
          text: normalizeGoogleKeywordText(keyword.text),
          matchType:
            typeof keyword.matchType === 'string' ? keyword.matchType : null,
          status:
            criterion.status === 'ENABLED' || criterion.status === 'PAUSED'
              ? criterion.status
              : null,
          impressions: metric('impressions'),
          clicks: metric('clicks'),
          interactions: metric('interactions'),
          conversions: metric('conversions'),
        },
      ];
    });
  }

  private resolve(input: GoogleAdActionInput) {
    return this.credentials.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      connectionId: input.connectionId,
    });
  }

  private async readState(
    credential: ResolvedAdCredential,
    input: GoogleAdActionInput,
  ): Promise<GoogleAdWritableState> {
    const { target, actionType } = input;
    this.assertIds(target);
    const customer = credential.externalAccountId;
    const empty: GoogleAdWritableState = {
      status: null,
      budget: null,
      criterionResourceName: null,
    };

    if (actionType === 'set_status' || actionType === 'set_budget') {
      const rows = await this.client.search(
        credential,
        this.objectQuery(target),
      );
      const row = rows[0];
      if (!row) throw new GoogleAdManualActionError('google_object_not_found');
      return {
        ...empty,
        status: this.statusOf(row, target.kind),
        budget: target.kind === 'campaign' ? this.budgetOf(row) : null,
      };
    }

    const text = normalizeGoogleKeywordText(this.scalar(input.change.text));
    const matchType =
      typeof input.change.matchType === 'string'
        ? input.change.matchType
        : null;

    if (actionType === 'negative_keyword') {
      const rows = await this.client.search(
        credential,
        `SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type FROM campaign_criterion WHERE campaign_criterion.campaign = 'customers/${customer}/campaigns/${target.id}' AND campaign_criterion.type = 'KEYWORD' AND campaign_criterion.negative = TRUE AND campaign_criterion.status != 'REMOVED'`,
      );
      return {
        ...empty,
        criterionResourceName: this.findKeyword(
          rows,
          'campaignCriterion',
          text,
          matchType,
        ),
      };
    }

    if (actionType === 'keyword') {
      const rows = await this.client.search(
        credential,
        `SELECT ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group_criterion.ad_group = 'customers/${customer}/adGroups/${target.id}' AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'`,
      );
      const criterionResourceName = this.findKeyword(
        rows,
        'adGroupCriterion',
        text,
        matchType,
      );
      const match = rows.find(
        (row) =>
          this.record(row.adGroupCriterion).resourceName ===
          criterionResourceName,
      );
      const status = this.record(match?.adGroupCriterion).status;
      return {
        ...empty,
        // The keyword's own status: `pause`/`enable` compare and verify it.
        status:
          criterionResourceName && typeof status === 'string' ? status : null,
        criterionResourceName,
      };
    }

    if (actionType === 'search_theme') {
      const rows = await this.client.search(
        credential,
        `SELECT asset_group_signal.resource_name, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group_signal.asset_group = 'customers/${customer}/assetGroups/${target.id}'`,
      );
      const wanted = text.toLowerCase();
      for (const row of rows) {
        const signal = this.record(row.assetGroupSignal);
        const theme = this.record(signal.searchTheme);
        if (
          typeof theme.text === 'string' &&
          normalizeGoogleKeywordText(theme.text).toLowerCase() === wanted
        ) {
          return {
            ...empty,
            criterionResourceName: this.criterionName(signal.resourceName),
          };
        }
      }
      return empty;
    }

    throw new GoogleAdManualActionError('google_action_not_supported');
  }

  private objectQuery(target: GoogleAdTarget): string {
    if (target.kind === 'campaign') {
      return `SELECT campaign.id, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${target.id}`;
    }
    if (target.kind === 'ad_group') {
      return `SELECT ad_group.id, ad_group.status FROM ad_group WHERE ad_group.id = ${target.id}`;
    }
    if (target.kind === 'asset_group') {
      return `SELECT asset_group.id, asset_group.status FROM asset_group WHERE asset_group.id = ${target.id}`;
    }
    return `SELECT ad_group_ad.ad.id, ad_group_ad.status FROM ad_group_ad WHERE ad_group.id = ${target.adGroupId} AND ad_group_ad.ad.id = ${target.id}`;
  }

  private toMutation(
    credential: ResolvedAdCredential,
    input: GoogleAdActionInput,
    state: GoogleAdWritableState,
  ): {
    resource: GoogleAdsMutateResource;
    operations: Array<Record<string, unknown>>;
  } {
    const { target, actionType, change } = input;
    this.assertIds(target);
    const customer = credential.externalAccountId;

    if (actionType === 'set_status') {
      return {
        resource: STATUS_RESOURCE[target.kind],
        operations: [
          {
            update: {
              resourceName: this.objectName(customer, target),
              status: this.googleStatus(change.status),
            },
            updateMask: 'status',
          },
        ],
      };
    }

    if (actionType === 'set_budget') {
      const budget = state.budget;
      if (!budget || !BUDGET_RESOURCE.test(budget.resourceName)) {
        throw new GoogleAdManualActionError('google_budget_not_found');
      }
      if (budget.shared)
        throw new GoogleAdManualActionError('google_budget_shared');
      const minor = this.scalar(change.budgetAmountMinor);
      if (!/^\d{1,16}$/.test(minor)) {
        throw new GoogleAdManualActionError('google_budget_invalid');
      }
      return {
        resource: 'campaignBudgets',
        operations: [
          {
            update: {
              resourceName: budget.resourceName,
              amountMicros: String(BigInt(minor) * MICROS_PER_MINOR),
            },
            updateMask: 'amount_micros',
          },
        ],
      };
    }

    const resource: GoogleAdsMutateResource =
      actionType === 'negative_keyword'
        ? 'campaignCriteria'
        : actionType === 'keyword'
          ? 'adGroupCriteria'
          : 'assetGroupSignals';

    if (change.op === 'remove') {
      if (!state.criterionResourceName) {
        throw new GoogleAdManualActionError('google_keyword_not_found');
      }
      return {
        resource,
        operations: [{ remove: state.criterionResourceName }],
      };
    }

    if (change.op === 'pause' || change.op === 'enable') {
      if (actionType !== 'keyword') {
        throw new GoogleAdManualActionError('google_action_not_supported');
      }
      if (!state.criterionResourceName) {
        throw new GoogleAdManualActionError('google_keyword_not_found');
      }
      return {
        resource,
        operations: [
          {
            update: {
              resourceName: state.criterionResourceName,
              status: change.op === 'pause' ? 'PAUSED' : 'ENABLED',
            },
            updateMask: 'status',
          },
        ],
      };
    }

    const text = normalizeGoogleKeywordText(this.scalar(change.text));
    const keyword = { text, matchType: this.scalar(change.matchType) };
    if (actionType === 'negative_keyword') {
      return {
        resource,
        operations: [
          {
            create: {
              campaign: `customers/${customer}/campaigns/${target.id}`,
              negative: true,
              keyword,
            },
          },
        ],
      };
    }
    if (actionType === 'keyword') {
      return {
        resource,
        operations: [
          {
            create: {
              adGroup: `customers/${customer}/adGroups/${target.id}`,
              status: 'ENABLED',
              keyword,
            },
          },
        ],
      };
    }
    if (actionType === 'search_theme') {
      return {
        resource,
        operations: [
          {
            create: {
              assetGroup: `customers/${customer}/assetGroups/${target.id}`,
              searchTheme: { text },
            },
          },
        ],
      };
    }
    throw new GoogleAdManualActionError('google_action_not_supported');
  }

  private matchesExpected(
    current: GoogleAdWritableState,
    expected: GoogleAdWritableState,
    actionType: SocialAdManualActionType,
  ) {
    if (actionType === 'set_status') return current.status === expected.status;
    if (actionType === 'set_budget') {
      return (
        current.budget !== null &&
        expected.budget !== null &&
        current.budget.resourceName === expected.budget.resourceName &&
        current.budget.amountMinor === expected.budget.amountMinor &&
        current.budget.shared === false
      );
    }
    return (
      current.criterionResourceName === expected.criterionResourceName &&
      current.status === expected.status
    );
  }

  private matchesChange(
    state: GoogleAdWritableState,
    input: GoogleAdActionInput,
  ) {
    if (input.actionType === 'set_status') {
      return state.status === this.googleStatus(input.change.status);
    }
    if (input.actionType === 'set_budget') {
      return (
        state.budget?.amountMinor === String(input.change.budgetAmountMinor)
      );
    }
    if (input.change.op === 'pause') return state.status === 'PAUSED';
    if (input.change.op === 'enable') return state.status === 'ENABLED';
    return input.change.op === 'remove'
      ? state.criterionResourceName === null
      : state.criterionResourceName !== null;
  }

  private findKeyword(
    rows: GoogleAdsRawRow[],
    key: 'campaignCriterion' | 'adGroupCriterion',
    text: string,
    matchType: string | null,
  ): string | null {
    const wanted = text.toLowerCase();
    for (const row of rows) {
      const criterion = this.record(row[key]);
      const keyword = this.record(criterion.keyword);
      if (
        typeof keyword.text === 'string' &&
        normalizeGoogleKeywordText(keyword.text).toLowerCase() === wanted &&
        keyword.matchType === matchType
      ) {
        return this.criterionName(criterion.resourceName);
      }
    }
    return null;
  }

  private statusOf(row: GoogleAdsRawRow, kind: GoogleAdTarget['kind']) {
    const node =
      kind === 'campaign'
        ? row.campaign
        : kind === 'ad_group'
          ? row.adGroup
          : kind === 'asset_group'
            ? row.assetGroup
            : row.adGroupAd;
    const status = this.record(node).status;
    return typeof status === 'string' && status ? status : null;
  }

  private budgetOf(row: GoogleAdsRawRow): GoogleAdBudgetState | null {
    const budget = this.record(row.campaignBudget);
    if (typeof budget.resourceName !== 'string') return null;
    const micros =
      typeof budget.amountMicros === 'string' ||
      typeof budget.amountMicros === 'number'
        ? String(budget.amountMicros)
        : null;
    return {
      resourceName: budget.resourceName,
      amountMinor:
        micros && /^\d{1,24}$/.test(micros)
          ? String(BigInt(micros) / MICROS_PER_MINOR)
          : null,
      period: typeof budget.period === 'string' ? budget.period : null,
      // Absent means false in Google's JSON (proto3 default).
      shared: budget.explicitlyShared === true,
    };
  }

  private objectName(customer: string, target: GoogleAdTarget) {
    if (target.kind === 'campaign') {
      return `customers/${customer}/campaigns/${target.id}`;
    }
    if (target.kind === 'ad_group') {
      return `customers/${customer}/adGroups/${target.id}`;
    }
    if (target.kind === 'asset_group') {
      return `customers/${customer}/assetGroups/${target.id}`;
    }
    return `customers/${customer}/adGroupAds/${target.adGroupId}~${target.id}`;
  }

  private googleStatus(status: unknown) {
    return status === 'ACTIVE' ? 'ENABLED' : 'PAUSED';
  }

  private criterionName(value: unknown): string | null {
    return typeof value === 'string' && CRITERION_RESOURCE.test(value)
      ? value
      : null;
  }

  /** Ids are interpolated into GAQL and resource names: digits only. */
  private assertIds(target: GoogleAdTarget) {
    if (
      !ID.test(target.id) ||
      (target.kind === 'ad_group_ad' &&
        (!target.adGroupId || !ID.test(target.adGroupId)))
    ) {
      throw new GoogleAdManualActionError('google_object_not_found');
    }
  }

  /** A stored string or number as text; anything else is empty. */
  private scalar(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }
}
