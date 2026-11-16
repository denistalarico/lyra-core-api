import { YoutubeOrganicAnalyticsProvider } from './youtube-organic-analytics.provider';
import { intOrNull, minutesToSeconds } from './youtube-organic.normalizer';

const credential = {
  assetId: 'asset-1',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  accessToken: 'tok',
};

function build() {
  const query = jest
    .fn()
    .mockImplementation((args: { dimensions: string; startDate: string }) =>
      Promise.resolve(
        args.dimensions === 'day'
          ? [
              {
                day: '2026-11-12',
                views: 10,
                estimatedMinutesWatched: 2,
                subscribersGained: 1,
                subscribersLost: 0,
                likes: 3,
                comments: 1,
                shares: 0,
                averageViewDuration: 12,
                engagedViews: 9,
              },
              {
                day: '2026-11-14',
                views: 20,
                estimatedMinutesWatched: 1.5,
                subscribersGained: 2,
                subscribersLost: 1,
                likes: 4,
                comments: 0,
                shares: 1,
                averageViewDuration: 5,
                engagedViews: 18,
              },
            ]
          : [
              {
                video: 'vid1',
                views: 7,
                estimatedMinutesWatched: 1,
                likes: 1,
                comments: 0,
                shares: 0,
                averageViewDuration: 8,
                engagedViews: 6,
              },
            ],
      ),
    );
  const client = {
    query,
    subscriberCount: jest.fn().mockResolvedValue(321),
    videoDetails: jest.fn().mockResolvedValue({
      apiCalls: 1,
      details: [
        {
          videoId: 'vid1',
          title: 'Meu vídeo',
          publishedAt: new Date('2026-11-01T00:00:00Z'),
        },
      ],
    }),
  };
  const writer = {
    upsert: jest.fn().mockResolvedValue({ accountRows: 2, postRows: 4 }),
  };
  const dataSource = {
    query: jest
      .fn()
      .mockResolvedValue([
        { id: 'pub-1', external_publication_id: 'yt-video:vid1' },
      ]),
  };
  const provider = new YoutubeOrganicAnalyticsProvider(
    client as never,
    writer as never,
    dataSource as never,
  );
  return { provider, client, writer, dataSource };
}

describe('YoutubeOrganicAnalyticsProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-16T15:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  const run = (fromDate: string, toDate: string) => {
    const ctx = build();
    const counters = { rowsWritten: 0, rowsSkipped: 0, apiCalls: 0 };
    return ctx.provider
      .sync({
        resolved: { credential, assetTimezone: 'UTC' } as never,
        fromDate,
        toDate,
        syncRunId: 'run-1',
        counters,
      })
      .then(() => ({ ...ctx, counters }));
  };

  it('cuts the window at yesterday and widens a daily window to D-3', async () => {
    const { client, writer, counters } = await run('2026-11-15', '2026-11-16');
    const day = client.query.mock.calls.find(
      ([a]) => a.dimensions === 'day',
    )![0];
    expect(day.startDate).toBe('2026-11-13');
    expect(day.endDate).toBe('2026-11-15');
    const videoDays = client.query.mock.calls
      .filter(([a]) => a.dimensions === 'video')
      .map(([a]) => a.startDate);
    expect(videoDays).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    // 1 channel day + 1 channels.list + 3 video days + 1 videos.list
    expect(counters.apiCalls).toBe(6);
    expect(counters.rowsWritten).toBe(6);
    expect(writer.upsert).toHaveBeenCalledTimes(1);
  });

  it('marks D-1 and D-2 partial, and stamps the subscriber count only on the latest day', async () => {
    const { writer } = await run('2026-11-15', '2026-11-16');
    const { accountRows, postRows } = writer.upsert.mock.calls[0][0];
    const byDay = Object.fromEntries(
      accountRows.map((r: { metricDate: string }) => [r.metricDate, r]),
    );
    expect(byDay['2026-11-12'].isPartial).toBe(false);
    expect(byDay['2026-11-14'].isPartial).toBe(true);
    expect(byDay['2026-11-12'].followersCount).toBeNull();
    expect(byDay['2026-11-14'].followersCount).toBe('321');
    expect(byDay['2026-11-14'].watchTimeSeconds).toBe('90');
    const post = postRows.find(
      (r: { metricDate: string }) => r.metricDate === '2026-11-15',
    );
    expect(post).toMatchObject({
      externalPublicationId: 'vid1',
      publicationId: 'pub-1',
      caption: 'Meu vídeo',
      videoViews: '7',
      watchTimeSeconds: '60',
      isPartial: true,
      provider: 'youtube',
    });
  });

  it('keeps a backfill window as asked (no widening, no future days)', async () => {
    const { client } = await run('2026-10-01', '2026-10-03');
    const day = client.query.mock.calls.find(
      ([a]) => a.dimensions === 'day',
    )![0];
    expect([day.startDate, day.endDate]).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('does nothing when the window starts after yesterday', async () => {
    const { client, writer } = await run('2026-11-16', '2026-11-16');
    expect(client.query).not.toHaveBeenCalled();
    expect(writer.upsert).not.toHaveBeenCalled();
  });
});

describe('youtube normalizer helpers', () => {
  it('rounds, floors at zero and keeps missing values null', () => {
    expect(intOrNull(3.6)).toBe('4');
    expect(intOrNull(-2)).toBe('0');
    expect(intOrNull(undefined)).toBeNull();
    expect(minutesToSeconds(1.5)).toBe('90');
    expect(minutesToSeconds(undefined)).toBeNull();
  });
});
