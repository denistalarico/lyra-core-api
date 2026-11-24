import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { ThreadsApiError } from '../../providers/threads/threads-api.client';
import {
  calendarDayIn,
  localDayStartEpochSeconds,
  shiftCalendarDay,
} from '../social-organic-analytics-time';
import { classifyOrganicSyncFailure } from '../social-organic-sync-retry';
import { ThreadsOrganicAnalyticsProvider } from './threads-organic-analytics.provider';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'threads',
  assetType: 'threads_account',
  externalAssetId: '1789',
  scopes: ['threads_basic', 'threads_manage_insights'],
  credentialVersion: 1,
  accessToken: 'tok',
});

const tz = 'America/Sao_Paulo';
const today = calendarDayIn(tz, new Date());
const yesterday = shiftCalendarDay(today, -1);
/** Meta stamps a day with the start of the next one (São Paulo = 03:00 Z). */
const endOf = (day: string) =>
  new Date(
    localDayStartEpochSeconds(shiftCalendarDay(day, 1), tz) * 1000,
  ).toISOString();

const totals = (likes: number) => ({
  viewsSeries: [],
  likes,
  replies: 2,
  reposts: 1,
  quotes: 0,
  clicks: 4,
});

function build() {
  const client = {
    userInsights: jest
      .fn()
      // The window call: the views series.
      .mockResolvedValueOnce({
        viewsSeries: [
          { endTime: endOf(yesterday), value: 120 },
          { endTime: endOf(today), value: 30 },
        ],
        likes: 99,
        replies: 99,
        reposts: 99,
        quotes: 99,
        clicks: 99,
      })
      .mockResolvedValueOnce(totals(10))
      .mockResolvedValueOnce(totals(3)),
    followersCount: jest.fn().mockResolvedValue(812),
    listPosts: jest.fn().mockResolvedValue({
      posts: [
        {
          id: '555',
          mediaType: 'TEXT_POST',
          permalink: 'https://www.threads.com/@lyra/post/x',
          text: 'Oi',
          timestamp: '2026-11-20T12:00:00+0000',
        },
        {
          id: '556',
          mediaType: 'REPOST_FACADE',
          permalink: null,
          text: null,
          timestamp: null,
        },
      ],
      after: null,
    }),
    postInsights: jest.fn().mockResolvedValue({
      views: 300,
      likes: 12,
      replies: 3,
      reposts: 2,
      quotes: 1,
      shares: null,
    }),
  };
  const writer = {
    upsert: jest.fn().mockResolvedValue({ accountRows: 2, postRows: 1 }),
  };
  const dataSource = {
    query: jest
      .fn()
      .mockResolvedValue([{ id: 'pub1', external_publication_id: '555' }]),
  };
  return {
    client,
    writer,
    provider: new ThreadsOrganicAnalyticsProvider(
      client as never,
      writer as never,
      dataSource as never,
    ),
  };
}

const counters = () => ({ rowsWritten: 0, rowsSkipped: 0, apiCalls: 0 });

describe('ThreadsOrganicAnalyticsProvider', () => {
  it('files views by end_time, totals per day, followers on today, posts lifetime', async () => {
    const { provider, client, writer } = build();
    const c = counters();
    await provider.sync({
      resolved: { credential, assetTimezone: tz },
      fromDate: yesterday,
      toDate: today,
      syncRunId: 'run1',
      counters: c,
    });

    const window = client.userInsights.mock.calls[0][0];
    expect(window).toMatchObject({ userId: '1789', accessToken: 'tok' });
    expect(window.since).toBe(localDayStartEpochSeconds(yesterday, tz));
    // One call per day for the window totals.
    expect(client.userInsights).toHaveBeenCalledTimes(3);
    expect(client.userInsights.mock.calls[1][0]).toMatchObject({
      since: localDayStartEpochSeconds(yesterday, tz),
      until: localDayStartEpochSeconds(today, tz),
    });
    // The repost facade has no insights of its own.
    expect(client.postInsights).toHaveBeenCalledTimes(1);
    expect(c.apiCalls).toBe(3 + 1 + 1 + 1);
    expect(c.rowsWritten).toBe(3);

    const { accountRows, postRows } = writer.upsert.mock.calls[0][0];
    const [first, second] = accountRows;
    expect(first).toMatchObject({
      provider: 'threads',
      metricDate: yesterday,
      viewsTotal: '120',
      likes: '10',
      comments: '2',
      shares: '1',
      totalInteractions: '13',
      followersCount: null,
      isPartial: false,
      providerMetrics: { quotes: '0', linkClicks: '4' },
    });
    expect(second).toMatchObject({
      metricDate: today,
      viewsTotal: '30',
      likes: '3',
      followersCount: '812',
      isPartial: true,
    });
    expect(postRows).toHaveLength(1);
    expect(postRows[0]).toMatchObject({
      externalPublicationId: '555',
      publicationId: 'pub1',
      metricDate: today,
      likesLifetime: '12',
      commentsLifetime: '3',
      repostsLifetime: '2',
      videoViewsLifetime: '300',
      sharesLifetime: null,
      mediaType: 'text_post',
      providerMetrics: { quotes: '1' },
    });
  });

  it('skips followers and posts when the window ends before today', async () => {
    const { provider, client, writer } = build();
    client.userInsights.mockReset().mockResolvedValue(totals(5));
    await provider.sync({
      resolved: { credential, assetTimezone: tz },
      fromDate: shiftCalendarDay(today, -3),
      toDate: shiftCalendarDay(today, -3),
      syncRunId: 'run1',
      counters: counters(),
    });
    // A one-day window reuses the window call for its totals.
    expect(client.userInsights).toHaveBeenCalledTimes(1);
    expect(client.followersCount).not.toHaveBeenCalled();
    expect(client.listPosts).not.toHaveBeenCalled();
    expect(writer.upsert.mock.calls[0][0].accountRows[0]).toMatchObject({
      likes: '5',
      viewsTotal: null,
    });
  });

  it('retries rate limits and network failures only', () => {
    expect(classifyOrganicSyncFailure(new ThreadsApiError(400, 4))).toEqual({
      retry: true,
      rateLimited: true,
      code: 'threads_4',
    });
    expect(classifyOrganicSyncFailure(new ThreadsApiError(0, null))).toEqual({
      retry: true,
      rateLimited: false,
      code: 'threads_0',
    });
    expect(classifyOrganicSyncFailure(new ThreadsApiError(400, 190))).toEqual({
      retry: false,
      rateLimited: false,
      code: 'threads_190',
    });
  });
});
