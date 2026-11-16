import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { TiktokOrganicAnalyticsProvider } from './tiktok-organic-analytics.provider';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'tiktok',
  assetType: 'tiktok_account',
  externalAssetId: 'o1',
  scopes: ['video.list'],
  credentialVersion: 1,
  accessToken: 'tok',
});

function build() {
  const client = {
    userInfo: jest.fn().mockResolvedValue({
      openId: 'o1',
      displayName: null,
      avatarUrl: null,
      followerCount: 120,
      followingCount: 3,
      likesCount: 900,
      videoCount: 4,
    }),
    listVideos: jest
      .fn()
      .mockResolvedValueOnce({
        videos: [
          {
            id: 'v1',
            title: 'T',
            createTime: 1_700_000_000,
            shareUrl: 'https://tiktok.com/@u/video/v1',
            viewCount: 10,
            likeCount: 2,
            commentCount: 1,
            shareCount: 0,
          },
        ],
        cursor: 5,
        hasMore: true,
      })
      .mockResolvedValueOnce({ videos: [], cursor: null, hasMore: false }),
  };
  const writer = {
    upsert: jest.fn().mockResolvedValue({ accountRows: 1, postRows: 1 }),
  };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  return {
    client,
    writer,
    provider: new TiktokOrganicAnalyticsProvider(
      client as never,
      writer as never,
      dataSource as never,
    ),
  };
}

const counters = () => ({ rowsWritten: 0, rowsSkipped: 0, apiCalls: 0 });

describe('TiktokOrganicAnalyticsProvider', () => {
  it('writes one snapshot day: followers stock and lifetime counters only', async () => {
    const { provider, client, writer } = build();
    const c = counters();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: '2000-01-01',
      toDate: '2999-12-31',
      syncRunId: 'run1',
      counters: c,
    });
    expect(client.listVideos).toHaveBeenCalledTimes(2);
    expect(client.listVideos.mock.calls[1][0].cursor).toBe(5);
    const { accountRows, postRows } = writer.upsert.mock.calls[0][0];
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0]).toMatchObject({
      provider: 'tiktok',
      followersCount: '120',
      followersGained: null,
      viewsTotal: null,
      isPartial: false,
    });
    expect(postRows[0]).toMatchObject({
      provider: 'tiktok',
      externalPublicationId: 'v1',
      videoViews: null,
      videoViewsLifetime: '10',
      likesLifetime: '2',
      commentsLifetime: '1',
      sharesLifetime: '0',
    });
    expect(accountRows[0].metricDate).toBe(postRows[0].metricDate);
    expect(c).toEqual({ rowsWritten: 2, rowsSkipped: 0, apiCalls: 3 });
  });

  it('skips a window that ended before today (TikTok only answers now)', async () => {
    const { provider, client, writer } = build();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: '2020-01-01',
      toDate: '2020-01-31',
      syncRunId: 'run1',
      counters: counters(),
    });
    expect(client.userInfo).not.toHaveBeenCalled();
    expect(writer.upsert).not.toHaveBeenCalled();
  });
});
