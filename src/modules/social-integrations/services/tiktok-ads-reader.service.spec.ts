import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { TikTokAdsApiClient } from './tiktok-ads-api.client';
import {
  TIKTOK_LEVEL,
  TIKTOK_REPORT_METRICS,
  TikTokAdsReaderService,
} from './tiktok-ads-reader.service';

const credential = {
  externalAccountId: '700',
  accessToken: 'tok',
} as unknown as ResolvedAdCredential;

function build() {
  const get = jest.fn().mockResolvedValue({ list: [] });
  const getPage = jest
    .fn()
    .mockResolvedValue({ rows: [], totalPages: 1, apiCalls: 1 });
  const reader = new TikTokAdsReaderService({
    get,
    getPage,
  } as unknown as TikTokAdsApiClient);

  return { reader, get, getPage };
}

describe('TikTokAdsReaderService', () => {
  it('pins the report metrics (one invalid metric fails the request)', () => {
    expect([...TIKTOK_REPORT_METRICS]).toEqual([
      'spend',
      'impressions',
      'clicks',
      'reach',
      'frequency',
      'conversion',
      'video_play_actions',
    ]);
  });

  it('maps the levels 1:1 to data levels and id dimensions (D-I8)', () => {
    expect(TIKTOK_LEVEL.campaign).toEqual({
      dataLevel: 'AUCTION_CAMPAIGN',
      idDimension: 'campaign_id',
    });
    expect(TIKTOK_LEVEL.adset.dataLevel).toBe('AUCTION_ADGROUP');
    expect(TIKTOK_LEVEL.ad.dataLevel).toBe('AUCTION_AD');
    expect(TIKTOK_LEVEL.account.dataLevel).toBe('AUCTION_ADVERTISER');
  });

  it('asks one BASIC daily report per level for a window of up to 30 days', async () => {
    const { reader, getPage } = build();

    await reader.readDailyMetrics(credential, 'campaign', {
      since: '2026-10-17',
      until: '2026-11-15',
      days: 30,
    });

    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage.mock.calls[0][1]).toBe('report/integrated/get/');
    expect(getPage.mock.calls[0][2]).toMatchObject({
      advertiser_id: '700',
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: ['campaign_id', 'stat_time_day'],
      start_date: '2026-10-17',
      end_date: '2026-11-15',
      page: 1,
      page_size: 1000,
    });
  });

  it('cuts a longer window into 30-day requests', async () => {
    const { reader, getPage } = build();

    const out = await reader.readDailyMetrics(credential, 'ad', {
      since: '2026-09-01',
      until: '2026-11-15',
      days: 76,
    });

    const ranges = getPage.mock.calls.map((call) => [
      (call[2] as { start_date: string }).start_date,
      (call[2] as { end_date: string }).end_date,
    ]);
    expect(ranges).toEqual([
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-30'],
      ['2026-10-31', '2026-11-15'],
    ]);
    expect(out.apiCalls).toBe(3);
  });

  it('walks pages until total_page and refuses a malformed window', async () => {
    const { reader, getPage } = build();
    getPage
      .mockResolvedValueOnce({ rows: [{ a: 1 }], totalPages: 2, apiCalls: 1 })
      .mockResolvedValueOnce({ rows: [{ a: 2 }], totalPages: 2, apiCalls: 1 });

    const out = await reader.readDailyMetrics(credential, 'adset', {
      since: '2026-11-01',
      until: '2026-11-02',
      days: 2,
    });

    expect(out.rows).toHaveLength(2);
    expect(getPage.mock.calls[1][2]).toMatchObject({ page: 2 });
    await expect(
      reader.readDailyMetrics(credential, 'ad', {
        since: '2026-11-01"]',
        until: '2026-11-02',
        days: 2,
      }),
    ).rejects.toMatchObject({ code: 'tiktok_ads_bad_request' });
  });

  it('reads the hierarchy only through read endpoints', async () => {
    const { reader, get, getPage } = build();

    await reader.readHierarchy(credential);

    expect(get.mock.calls[0][1]).toBe('advertiser/info/');
    expect(getPage.mock.calls.map((call) => call[1])).toEqual([
      'campaign/get/',
      'adgroup/get/',
      'ad/get/',
    ]);
  });
});
