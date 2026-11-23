import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { classifyOrganicSyncFailure } from '../social-organic-sync-retry';
import { TiktokBusinessApiError } from '../../providers/tiktok-business/tiktok-business-api.client';
import {
  calendarDayIn,
  shiftCalendarDay,
} from '../social-organic-analytics-time';
import { TiktokBusinessOrganicAnalyticsProvider } from './tiktok-business-organic-analytics.provider';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'tiktok_business',
  assetType: 'tiktok_business_account',
  externalAssetId: 'biz1',
  scopes: ['user.insights', 'video.list', 'video.insights'],
  credentialVersion: 1,
  accessToken: 'tok',
});

const today = calendarDayIn('UTC', new Date());
const yesterday = shiftCalendarDay(today, -1);
const threeDaysAgo = shiftCalendarDay(today, -3);

const day = (date: string, overrides: Record<string, number | null> = {}) => ({
  date,
  videoViews: 100,
  uniqueVideoViews: 80,
  profileViews: 7,
  likes: 9,
  comments: 2,
  shares: 1,
  followersCount: 50,
  newFollowers: 3,
  lostFollowers: null,
  netFollowers: -1,
  engagedAudience: 6,
  bioLinkClicks: null,
  ...overrides,
});

function build() {
  const client = {
    accountInsights: jest.fn().mockResolvedValue({
      followersCount: 55,
      days: [day(threeDaysAgo), day(yesterday, { followersCount: null })],
    }),
    listVideos: jest
      .fn()
      .mockResolvedValueOnce({
        videos: [
          {
            itemId: 'v1',
            mediaType: 'VIDEO',
            createTime: 1_700_000_000,
            shareUrl: 'https://www.tiktok.com/@u/video/v1',
            caption: 'Oi',
            videoViews: 603,
            likes: 20,
            comments: 3,
            shares: 4,
            favorites: 5,
            reach: 400,
            newFollowers: 2,
            totalTimeWatched: 587.024,
            averageTimeWatched: 3.862,
            fullVideoWatchedRate: 0.0395,
          },
        ],
        cursor: 1_699_999_999_000,
        hasMore: true,
      })
      .mockResolvedValueOnce({ videos: [], cursor: null, hasMore: false }),
  };
  const writer = {
    upsert: jest.fn().mockResolvedValue({ accountRows: 2, postRows: 1 }),
  };
  const dataSource = {
    query: jest
      .fn()
      .mockResolvedValue([{ id: 'pub1', external_publication_id: 'v1' }]),
  };
  return {
    client,
    writer,
    dataSource,
    provider: new TiktokBusinessOrganicAnalyticsProvider(
      client as never,
      writer as never,
      dataSource as never,
    ),
  };
}

const counters = () => ({ rowsWritten: 0, rowsSkipped: 0, apiCalls: 0 });

describe('TiktokBusinessOrganicAnalyticsProvider', () => {
  it('writes the daily UTC series cut at yesterday and lifetime post counters', async () => {
    const { provider, client, writer } = build();
    const c = counters();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: shiftCalendarDay(today, -6),
      toDate: today,
      syncRunId: 'run1',
      counters: c,
    });

    expect(client.accountInsights).toHaveBeenCalledWith({
      accessToken: 'tok',
      businessId: 'biz1',
      startDate: shiftCalendarDay(today, -6),
      endDate: yesterday,
    });
    expect(client.listVideos).toHaveBeenCalledTimes(2);
    expect(client.listVideos.mock.calls[1][0].cursor).toBe(1_699_999_999_000);
    expect(c.apiCalls).toBe(3);
    expect(c.rowsWritten).toBe(3);

    const { accountRows, postRows } = writer.upsert.mock.calls[0][0];
    // Only the days TikTok answered; no zero-filled gaps.
    expect(
      accountRows.map((row: { metricDate: string }) => row.metricDate),
    ).toEqual([threeDaysAgo, yesterday]);
    const [older, newest] = accountRows;
    expect(older).toMatchObject({
      provider: 'tiktok_business',
      viewsTotal: '100',
      impressions: null,
      reach: '80',
      profileViews: '7',
      likes: '9',
      comments: '2',
      shares: '1',
      followersCount: '50',
      followersGained: '3',
      followersLost: null,
      accountsEngaged: '6',
      isPartial: false,
    });
    expect(older.providerMetrics).toEqual({
      netFollowers: -1,
      bioLinkClicks: null,
    });
    // The day's stock is missing: the real-time stock fills the newest day.
    expect(newest).toMatchObject({ followersCount: '55', isPartial: true });

    expect(postRows).toHaveLength(1);
    expect(postRows[0]).toMatchObject({
      provider: 'tiktok_business',
      externalPublicationId: 'v1',
      publicationId: 'pub1',
      metricDate: yesterday,
      videoViewsLifetime: '603',
      likesLifetime: '20',
      commentsLifetime: '3',
      sharesLifetime: '4',
      savesLifetime: '5',
      reachLifetime: '400',
      followsLifetime: '2',
      mediaType: 'video',
      videoViews: null,
      likes: null,
    });
    expect(postRows[0].publishedAt).toEqual(new Date(1_700_000_000_000));
    expect(postRows[0].providerMetrics).toEqual({
      totalTimeWatchedSeconds: 587.024,
      averageTimeWatchedSeconds: 3.862,
      fullVideoWatchedRate: 0.0395,
    });
  });

  it('skips the post snapshot when the window ends before yesterday', async () => {
    const { provider, client, writer } = build();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: shiftCalendarDay(today, -10),
      toDate: threeDaysAgo,
      syncRunId: 'run1',
      counters: counters(),
    });
    expect(client.accountInsights.mock.calls[0][0].endDate).toBe(threeDaysAgo);
    expect(client.listVideos).not.toHaveBeenCalled();
    expect(writer.upsert.mock.calls[0][0].postRows).toEqual([]);
  });

  it('clamps the look-back to 60 days and does nothing for a window of only today', async () => {
    const { provider, client } = build();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: shiftCalendarDay(today, -200),
      toDate: yesterday,
      syncRunId: 'run1',
      counters: counters(),
    });
    expect(client.accountInsights.mock.calls[0][0].startDate).toBe(
      shiftCalendarDay(today, -60),
    );

    const fresh = build();
    await fresh.provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: today,
      toDate: today,
      syncRunId: 'run1',
      counters: counters(),
    });
    expect(fresh.client.accountInsights).not.toHaveBeenCalled();
    expect(fresh.writer.upsert).not.toHaveBeenCalled();
  });
});

describe('classifyOrganicSyncFailure — TikTok Business', () => {
  it('retries throttling, network and 5xx; not an expired token', () => {
    expect(
      classifyOrganicSyncFailure(new TiktokBusinessApiError(200, 40100)),
    ).toEqual({
      retry: true,
      rateLimited: true,
      code: 'tiktok_business_40100',
    });
    expect(
      classifyOrganicSyncFailure(new TiktokBusinessApiError(0, null)),
    ).toMatchObject({
      retry: true,
      rateLimited: false,
    });
    expect(
      classifyOrganicSyncFailure(new TiktokBusinessApiError(503, null)),
    ).toMatchObject({
      retry: true,
    });
    expect(
      classifyOrganicSyncFailure(new TiktokBusinessApiError(200, 40105)),
    ).toEqual({
      retry: false,
      rateLimited: false,
      code: 'tiktok_business_40105',
    });
  });
});
