import {
  YOUTUBE_UPLOAD_CHUNK_BYTES,
  YoutubeApiClient,
  YoutubeUploadFault,
} from './youtube-api.client';

const SESSION =
  'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1';

function sourceOf(size: number) {
  const data = new Uint8Array(size).fill(7);
  return new Response(data, { headers: { 'content-length': String(size) } });
}

describe('YoutubeApiClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('starts a session on Google and refuses a foreign Location', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { location: SESSION } }),
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { location: 'https://evil.example/x' },
        }),
      ) as never;
    const client = new YoutubeApiClient();
    const args = {
      accessToken: 't',
      totalBytes: 10,
      mimeType: 'video/mp4',
      metadata: {
        snippet: { title: 'a', description: '', tags: [], categoryId: '22' },
        status: { privacyStatus: 'public' as const },
      },
    };
    await expect(client.startUpload(args)).resolves.toBe(SESSION);
    await expect(client.startUpload(args)).rejects.toBeInstanceOf(
      YoutubeUploadFault,
    );
  });

  it('sends chunks that are multiples of 256 KiB and ends with the id', async () => {
    const total = YOUTUBE_UPLOAD_CHUNK_BYTES + 1000;
    const ranges: string[] = [];
    const fetchMock = jest
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url === 'https://signed/x') return Promise.resolve(sourceOf(total));
        const range = (init!.headers as Record<string, string>)[
          'Content-Range'
        ];
        ranges.push(range);
        return Promise.resolve(
          range.startsWith(`bytes ${YOUTUBE_UPLOAD_CHUNK_BYTES}-`)
            ? new Response(JSON.stringify({ id: 'vid9' }), { status: 201 })
            : new Response(null, { status: 308 }),
        );
      });
    global.fetch = fetchMock as never;
    const id = await new YoutubeApiClient().uploadFromSource({
      sessionUrl: SESSION,
      sourceUrl: 'https://signed/x',
      totalBytes: total,
      mimeType: 'video/mp4',
    });
    expect(id).toBe('vid9');
    expect(YOUTUBE_UPLOAD_CHUNK_BYTES % (256 * 1024)).toBe(0);
    expect(ranges).toEqual([
      `bytes 0-${YOUTUBE_UPLOAD_CHUNK_BYTES - 1}/${total}`,
      `bytes ${YOUTUBE_UPLOAD_CHUNK_BYTES}-${total - 1}/${total}`,
    ]);
  });

  it('fails when the source size differs from the declared size', async () => {
    global.fetch = jest.fn().mockResolvedValue(sourceOf(500)) as never;
    await expect(
      new YoutubeApiClient().uploadFromSource({
        sessionUrl: SESSION,
        sourceUrl: 'https://signed/x',
        totalBytes: 900,
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'media_source_size_mismatch' });
  });

  it('re-sends a chunk after a 503 when the session holds nothing', async () => {
    const total = 1000;
    let puts = 0;
    global.fetch = jest
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url === 'https://signed/x') return Promise.resolve(sourceOf(total));
        puts += 1;
        const range = (init!.headers as Record<string, string>)[
          'Content-Range'
        ];
        if (puts === 1)
          return Promise.resolve(new Response(null, { status: 503 }));
        if (range.startsWith('bytes */'))
          return Promise.resolve(new Response(null, { status: 308 }));
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'v' }), { status: 200 }),
        );
      }) as never;
    await expect(
      new YoutubeApiClient().uploadFromSource({
        sessionUrl: SESSION,
        sourceUrl: 'https://signed/x',
        totalBytes: total,
        mimeType: 'video/mp4',
      }),
    ).resolves.toBe('v');
    expect(puts).toBe(3);
  });
});
