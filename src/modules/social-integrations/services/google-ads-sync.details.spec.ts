import { Logger } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { GoogleAdsError } from '../sync/google-ads-error';
import type {
  GoogleAdsCampaignDetailQuery,
  GoogleAdsRawPage,
  GoogleAdsReaderService,
} from './google-ads-reader.service';
import { GoogleAdsSyncService } from './google-ads-sync.service';
import type { SocialAdBreakdownWriterService } from './social-ad-breakdown-writer.service';
import type { SocialAdEntityWriterService } from './social-ad-entity-writer.service';
import type { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';
import type { SocialAdSearchTermWriterService } from './social-ad-search-term-writer.service';

const CREDENTIAL = {
  connectionId: 'c',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  provider: 'google_ads',
  externalAccountId: '1234567890',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
} as unknown as ResolvedAdCredential;

const WINDOW = { since: '2026-11-13', until: '2026-11-19', days: 7 };

const page = (
  rows: Array<Record<string, unknown>>,
  truncated = false,
): GoogleAdsRawPage => ({ rows, truncated, apiCalls: 1 });

const campaignFact = {
  campaign: { id: '11' },
  segments: { date: '2026-11-17' },
  metrics: { costMicros: '15480000', impressions: '19', clicks: '4' },
};

const network = (channelType: string) =>
  page([
    {
      campaign: { id: '11', advertisingChannelType: channelType },
      segments: { date: '2026-11-17', adNetworkType: 'SEARCH' },
      metrics: { costMicros: '1000000', impressions: '5', clicks: '1' },
    },
  ]);

const term = {
  campaign: { id: '11' },
  segments: { date: '2026-11-17' },
  searchTermView: { searchTerm: 'termo fictício secreto' },
  adGroupCriterion: { keyword: { text: 'termo fictício secreto' } },
  campaignSearchTermInsight: { categoryLabel: 'termo fictício secreto' },
  metrics: { impressions: '3', clicks: '1' },
};

function build(
  options: {
    channelType?: string;
    detail?: Partial<
      Record<GoogleAdsCampaignDetailQuery, () => Promise<GoogleAdsRawPage>>
    >;
  } = {},
) {
  const detail: Record<
    GoogleAdsCampaignDetailQuery,
    () => Promise<GoogleAdsRawPage>
  > = {
    ad_network: async () => network(options.channelType ?? 'PERFORMANCE_MAX'),
    conversion_action: async () => page([]),
    search_term: async () => page([term]),
    keyword: async () => page([term]),
    ...options.detail,
  };
  const reader = {
    readDailyMetrics: jest.fn(async () => page([campaignFact])),
    readCampaignDetail: jest.fn(
      async (_c: unknown, kind: GoogleAdsCampaignDetailQuery) => detail[kind](),
    ),
    readPmaxSearchCategories: jest.fn(async () => page([term])),
  };
  const metricsWriter = {
    upsert: jest.fn(async (rows: unknown[]) => rows.length),
  };
  const breakdownWriter = {
    upsert: jest.fn(async (rows: unknown[]) => rows.length),
  };
  const searchTermWriter = {
    upsert: jest.fn(async (rows: unknown[]) => rows.length),
  };
  const service = new GoogleAdsSyncService(
    reader as unknown as GoogleAdsReaderService,
    {} as SocialAdEntityWriterService,
    metricsWriter as unknown as SocialAdMetricsWriterService,
    breakdownWriter as unknown as SocialAdBreakdownWriterService,
    searchTermWriter as unknown as SocialAdSearchTermWriterService,
  );
  const ingest = (level: 'campaign' | 'adset' = 'campaign') =>
    service.ingestLevel({
      credential: CREDENTIAL,
      level,
      window: WINDOW,
      isPartial: false,
      syncedAt: new Date('2026-11-20T07:00:00Z'),
    });
  const detailKinds = () =>
    (
      reader.readCampaignDetail.mock.calls as unknown as Array<
        [unknown, string]
      >
    ).map(([, kind]) => kind);
  return { ingest, reader, breakdownWriter, searchTermWriter, detailKinds };
}

describe('GoogleAdsSyncService — campaign details (GA-DET)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('reads channel, conversion action and the PMax categories on the campaign pass', async () => {
    const { ingest, detailKinds, reader } = build();
    await ingest();
    expect([
      detailKinds(),
      (
        reader.readPmaxSearchCategories.mock.calls as unknown as Array<
          [unknown, string]
        >
      ).map((call) => call[1]),
    ]).toEqual([['ad_network', 'conversion_action'], ['11']]);
  });

  it('counts every detail operation in the level summary', async () => {
    const { ingest } = build();
    expect((await ingest()).apiCalls).toBe(4);
  });

  it('reads search terms and keywords only when a Search campaign served', async () => {
    const { ingest, detailKinds } = build({ channelType: 'SEARCH' });
    await ingest();
    expect(detailKinds()).toEqual([
      'ad_network',
      'conversion_action',
      'search_term',
      'keyword',
    ]);
  });

  it('never reads details on another level', async () => {
    const { ingest, reader } = build();
    await ingest('adset');
    expect(reader.readCampaignDetail).not.toHaveBeenCalled();
  });

  it('keeps the campaign level completed when a detail query is refused', async () => {
    const { ingest } = build({
      detail: {
        conversion_action: async () => {
          throw new GoogleAdsError(
            'permanent',
            'google_ads_bad_request',
            null,
            1,
          );
        },
      },
    });
    expect(await ingest()).toEqual(
      expect.objectContaining({ status: 'completed', written: 1, apiCalls: 4 }),
    );
  });

  it('stops the remaining details once the local budget is spent', async () => {
    const { ingest, detailKinds, reader } = build({
      detail: {
        ad_network: async () => {
          throw new GoogleAdsError('rate_limited', 'quota_budget_exhausted');
        },
      },
    });
    await ingest();
    expect([
      detailKinds(),
      reader.readPmaxSearchCategories.mock.calls.length,
    ]).toEqual([['ad_network'], 0]);
  });

  it('writes nothing from a truncated detail page', async () => {
    const { ingest, breakdownWriter } = build({
      detail: {
        ad_network: async () => ({ ...network('SEARCH'), truncated: true }),
      },
    });
    await ingest();
    expect(
      (
        breakdownWriter.upsert.mock.calls as unknown as Array<
          [Array<{ breakdownKind: string }>]
        >
      )
        .flatMap(([rows]) => rows)
        .some((row) => row.breakdownKind === 'ad_network'),
    ).toBe(false);
  });

  it('logs codes and counts, never a search term', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { ingest } = build({ channelType: 'SEARCH' });
    await ingest();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secreto');
  });
});
