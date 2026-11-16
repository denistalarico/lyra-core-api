import { YoutubeApiError } from '../../providers/youtube/youtube-api.client';
import {
  YOUTUBE_CHANNEL_DAY_METRICS,
  YOUTUBE_TOP_VIDEOS_LIMIT,
  YoutubeAnalyticsClient,
} from './youtube-analytics.client';

describe('YoutubeAnalyticsClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('pins the reviewed metric list (a wrong metric fails the whole query)', () => {
    expect([...YOUTUBE_CHANNEL_DAY_METRICS]).toEqual([
      'views',
      'engagedViews',
      'estimatedMinutesWatched',
      'averageViewDuration',
      'subscribersGained',
      'subscribersLost',
      'likes',
      'comments',
      'shares',
    ]);
    expect(YOUTUBE_TOP_VIDEOS_LIMIT).toBe(200);
  });

  it('queries the authorized channel and keys rows by column name', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          columnHeaders: [{ name: 'day' }, { name: 'views' }],
          rows: [['2026-11-10', 5], ['bad']],
        }),
      ),
    );
    global.fetch = fetchMock as never;
    const rows = await new YoutubeAnalyticsClient().query({
      accessToken: 'tok',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      dimensions: 'day',
      metrics: ['views'],
    });
    expect(rows).toEqual([{ day: '2026-11-10', views: 5 }]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe(
      'https://youtubeanalytics.googleapis.com/v2/reports',
    );
    expect(url.searchParams.get('ids')).toBe('channel==MINE');
    expect(url.searchParams.get('dimensions')).toBe('day');
  });

  it('returns no rows when the API omits them', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ columnHeaders: [{ name: 'day' }] })),
      ) as never;
    await expect(
      new YoutubeAnalyticsClient().query({
        accessToken: 't',
        startDate: 'a',
        endDate: 'b',
        dimensions: 'day',
        metrics: ['views'],
      }),
    ).resolves.toEqual([]);
  });

  it('keeps only status and reason of a failure', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
          { status: 403 },
        ),
      ) as never;
    const error = await new YoutubeAnalyticsClient()
      .subscriberCount('t')
      .catch((e) => e);
    expect(error).toBeInstanceOf(YoutubeApiError);
    expect(error).toMatchObject({ status: 403, reason: 'quotaExceeded' });
  });

  it('hides the subscriber count when the channel hides it', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              statistics: { hiddenSubscriberCount: true, subscriberCount: '9' },
            },
          ],
        }),
      ),
    ) as never;
    await expect(
      new YoutubeAnalyticsClient().subscriberCount('t'),
    ).resolves.toBeNull();
  });

  it('lists video titles 50 ids per call', async () => {
    const fetchMock = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'a',
                snippet: { title: 'T', publishedAt: '2026-11-01T10:00:00Z' },
              },
            ],
          }),
        ),
      ),
    );
    global.fetch = fetchMock as never;
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const out = await new YoutubeAnalyticsClient().videoDetails('t', ids);
    expect(out.apiCalls).toBe(3);
    expect(out.details[0]).toMatchObject({ videoId: 'a', title: 'T' });
  });
});
