import { createResolvedOrganicCredential } from '../../credentials/resolved-organic-credential';
import { shiftCalendarDay } from '../social-organic-analytics-time';
import { LinkedInOrganicAnalyticsProvider } from './linkedin-organic-analytics.provider';

const credential = createResolvedOrganicCredential({
  assetId: 'a1',
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  provider: 'linkedin',
  assetType: 'linkedin_organization',
  externalAssetId: '555',
  scopes: ['rw_organization_admin'],
  credentialVersion: 1,
  accessToken: 'tok',
});

const today = new Date().toISOString().slice(0, 10);
const yesterday = shiftCalendarDay(today, -1);
const old = shiftCalendarDay(today, -10);

function build() {
  const client = {
    dailyShareStatistics: jest.fn().mockResolvedValue([
      {
        day: old,
        stats: {
          impressions: 100,
          uniqueImpressions: 60,
          clicks: 3,
          likes: -2,
          comments: 1,
          shares: 0,
          engagement: 0.1,
        },
      },
    ]),
    dailyFollowerGains: jest
      .fn()
      .mockResolvedValue([{ day: old, organic: 4, paid: 1 }]),
    followerCount: jest.fn().mockResolvedValue(900),
    organizationPosts: jest.fn().mockResolvedValue([
      {
        urn: 'urn:li:share:1',
        commentary: 'c',
        lifecycleState: 'PUBLISHED',
        publishedAt: 1,
        createdAt: 1,
      },
      {
        urn: 'urn:li:ugcPost:2',
        commentary: null,
        lifecycleState: 'PUBLISHED',
        publishedAt: null,
        createdAt: 2,
      },
    ]),
    postStatistics: jest.fn().mockResolvedValue({
      stats: new Map([
        [
          'urn:li:share:1',
          {
            impressions: 50,
            uniqueImpressions: 40,
            clicks: 2,
            likes: 5,
            comments: 1,
            shares: 1,
            engagement: 0.2,
          },
        ],
      ]),
      apiCalls: 2,
    }),
  };
  const writer = {
    upsert: jest.fn().mockResolvedValue({ accountRows: 2, postRows: 2 }),
  };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  return {
    client,
    writer,
    provider: new LinkedInOrganicAnalyticsProvider(
      client as never,
      writer as never,
      dataSource as never,
    ),
  };
}

const counters = () => ({ rowsWritten: 0, rowsSkipped: 0, apiCalls: 0 });

describe('LinkedInOrganicAnalyticsProvider', () => {
  it('writes page days (UTC, cut at yesterday) and lifetime post snapshots', async () => {
    const { provider, client, writer } = build();
    const c = counters();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: old,
      toDate: today,
      syncRunId: 'run1',
      counters: c,
    });
    expect(client.dailyShareStatistics.mock.calls[0][2]).toEqual({
      fromDay: old,
      toDay: yesterday,
    });
    const { accountRows, postRows } = writer.upsert.mock.calls[0][0];
    expect(
      accountRows.map((row: { metricDate: string }) => row.metricDate),
    ).toEqual([old, yesterday]);
    expect(accountRows[0]).toMatchObject({
      provider: 'linkedin',
      impressions: '100',
      reach: '60',
      likes: '0',
      followersGained: '5',
      followersLost: null,
      followersCount: null,
      isPartial: false,
    });
    expect(accountRows[1]).toMatchObject({
      followersCount: '900',
      isPartial: true,
    });
    expect(postRows[0]).toMatchObject({
      externalPublicationId: 'urn:li:share:1',
      impressionsLifetime: '50',
      metricDate: yesterday,
    });
    expect(postRows[1]).toMatchObject({
      externalPublicationId: 'urn:li:ugcPost:2',
      impressionsLifetime: '0',
    });
    expect(c.apiCalls).toBe(6);
  });

  it('skips the stock and posts when the window ends before yesterday', async () => {
    const { provider, client } = build();
    await provider.sync({
      resolved: { credential, assetTimezone: 'UTC' },
      fromDate: old,
      toDate: old,
      syncRunId: 'run1',
      counters: counters(),
    });
    expect(client.followerCount).not.toHaveBeenCalled();
    expect(client.organizationPosts).not.toHaveBeenCalled();
  });
});
