import type { GoogleAdsRawPage } from '../services/google-ads-reader.service';
import {
  hashSearchTerm,
  normalizeGoogleAdsConversionActionBreakdown,
  normalizeGoogleAdsNetworkBreakdown,
  normalizeGoogleAdsSearchTerms,
  type GoogleAdsDetailContext,
} from './google-ads-detail.normalizer';

const CONTEXT: GoogleAdsDetailContext = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  connectionId: 'c',
  provider: 'google_ads',
  accountTimezone: 'America/Sao_Paulo',
  currency: 'BRL',
  isPartial: false,
  syncedAt: new Date('2026-11-20T10:00:00Z'),
};

const page = (rows: Array<Record<string, unknown>>): GoogleAdsRawPage => ({
  rows,
  truncated: false,
  apiCalls: 1,
});

const networkRow = (network: string, costMicros: string, conversions = 1) => ({
  campaign: { id: '11', advertisingChannelType: 'PERFORMANCE_MAX' },
  segments: { date: '2026-11-17', adNetworkType: network },
  metrics: {
    costMicros,
    impressions: '10',
    clicks: '2',
    conversions,
    conversionsValue: 0,
  },
});

describe('Google Ads detail normalizers (GA-DET)', () => {
  it('stores the channel as the lowercased Google enum at campaign level', () => {
    const [row] = normalizeGoogleAdsNetworkBreakdown(
      page([networkRow('YOUTUBE', '1500000')]),
      CONTEXT,
    ).rows;
    expect([
      row.entityLevel,
      row.entityExternalId,
      row.breakdownKind,
      row.breakdownKey,
      row.spend,
      row.conversions,
    ]).toEqual([
      'campaign',
      '11',
      'ad_network',
      'youtube',
      '1.500000',
      '1.000000',
    ]);
  });

  it('sums rows that share one campaign, day and channel', () => {
    const { rows } = normalizeGoogleAdsNetworkBreakdown(
      page([networkRow('SEARCH', '1000000'), networkRow('SEARCH', '500000')]),
      CONTEXT,
    );
    expect(rows.map((row) => [row.spend, row.impressions])).toEqual([
      ['1.500000', '20'],
    ]);
  });

  it("reports each campaign's channel type for the term reads", () => {
    const { channels } = normalizeGoogleAdsNetworkBreakdown(
      page([networkRow('SEARCH', '1')]),
      CONTEXT,
    );
    expect(channels).toEqual([
      { campaignId: '11', channelType: 'PERFORMANCE_MAX' },
    ]);
  });

  it('skips a row whose channel is not an enum value', () => {
    const result = normalizeGoogleAdsNetworkBreakdown(
      page([networkRow('search; drop', '1')]),
      CONTEXT,
    );
    expect([result.rows.length, result.skipped]).toEqual([0, 1]);
  });

  it('keys a conversion action by its id and keeps name and category in actions', () => {
    const [row] = normalizeGoogleAdsConversionActionBreakdown(
      page([
        {
          campaign: { id: '11' },
          segments: {
            date: '2026-11-17',
            conversionAction: 'customers/1234567890/conversionActions/987',
            conversionActionName: 'Envio de formulário',
            conversionActionCategory: 'SUBMIT_LEAD_FORM',
          },
          metrics: { conversions: 2.5, conversionsValue: 0 },
        },
      ]),
      CONTEXT,
    ).rows;
    expect([
      row.breakdownKey,
      row.actions.label,
      row.actions.category,
      row.conversions,
      row.spend,
    ]).toEqual([
      '987',
      'Envio de formulário',
      'SUBMIT_LEAD_FORM',
      '2.500000',
      '0.000000',
    ]);
  });

  it('aggregates a search term split across ad groups', () => {
    const term = (clicks: string) => ({
      campaign: { id: '11' },
      segments: { date: '2026-11-17' },
      searchTermView: { searchTerm: 'agência de marketing' },
      metrics: {
        impressions: '5',
        clicks,
        costMicros: '1000000',
        conversions: 0,
        conversionsValue: 0,
      },
    });
    const { rows } = normalizeGoogleAdsSearchTerms(
      page([term('1'), term('2')]),
      'search_term',
      CONTEXT,
    );
    expect(
      rows.map((row) => [row.termText, row.clicks, row.spend, row.termHash]),
    ).toEqual([
      [
        'agência de marketing',
        '3',
        '2.000000',
        hashSearchTerm('agência de marketing'),
      ],
    ]);
  });

  it('stores PMax categories without spend and keeps the catch-all category', () => {
    const { rows } = normalizeGoogleAdsSearchTerms(
      page([
        {
          campaignSearchTermInsight: { categoryLabel: '' },
          segments: { date: '2026-11-17' },
          metrics: { impressions: '7', clicks: '1', conversions: 1 },
        },
      ]),
      'pmax_category',
      CONTEXT,
      '11',
    );
    expect(
      rows.map((row) => [row.campaignExternalId, row.termText, row.spend]),
    ).toEqual([['11', '', null]]);
  });

  it('skips an empty search term', () => {
    const result = normalizeGoogleAdsSearchTerms(
      page([
        {
          campaign: { id: '11' },
          segments: { date: '2026-11-17' },
          searchTermView: { searchTerm: '   ' },
          metrics: {},
        },
      ]),
      'search_term',
      CONTEXT,
    );
    expect([result.rows.length, result.skipped]).toEqual([0, 1]);
  });

  it('bounds a long term to 512 characters', () => {
    const [row] = normalizeGoogleAdsSearchTerms(
      page([
        {
          campaign: { id: '11' },
          segments: { date: '2026-11-17' },
          adGroupCriterion: { keyword: { text: 'á'.repeat(600) } },
          metrics: {},
        },
      ]),
      'keyword',
      CONTEXT,
    ).rows;
    expect(Array.from(row.termText)).toHaveLength(512);
  });
});
