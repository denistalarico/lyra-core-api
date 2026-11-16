import {
  TIKTOK_CHUNK_BYTES,
  TiktokApiClient,
  TiktokApiError,
  TiktokUploadFault,
  planTiktokChunks,
  tiktokFailure,
} from './tiktok-api.client';

const MIB = 1024 * 1024;
const login = { clientKey: 'ck', clientSecret: 'cs' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('TiktokApiClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('plans one chunk up to 64 MiB, else 32 MiB chunks with the remainder in the last', () => {
    expect(planTiktokChunks(4 * MIB)).toEqual({
      chunkSize: 4 * MIB,
      totalChunkCount: 1,
    });
    expect(planTiktokChunks(64 * MIB).totalChunkCount).toBe(1);
    expect(planTiktokChunks(100 * MIB)).toEqual({
      chunkSize: TIKTOK_CHUNK_BYTES,
      totalChunkCount: 3,
    });
  });

  it('exchanges the code with the documented form fields', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      json({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 7200,
        refresh_expires_in: 15552000,
        open_id: 'o1',
        scope: 'user.info.basic,video.list',
        token_type: 'Bearer',
      }),
    );
    global.fetch = fetchMock as never;
    const grant = await new TiktokApiClient().exchangeCode({
      loginConfig: login,
      code: 'c',
      redirectUri: 'https://x/cb',
    });
    expect(grant).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 7200,
      scopes: ['user.info.basic', 'video.list'],
      openId: 'o1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.tiktokapis.com/v2/oauth/token/');
    expect(init.headers['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      client_key: 'ck',
      client_secret: 'cs',
      code: 'c',
      grant_type: 'authorization_code',
      redirect_uri: 'https://x/cb',
    });
  });

  it('surfaces the OAuth error string as the code', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(json({ error: 'invalid_grant' }, 400)) as never;
    await expect(
      new TiktokApiClient().refresh({ loginConfig: login, refreshToken: 'r' }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_grant' });
  });

  it('turns a 200 with a non-ok error code into an error (creator_info)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        json({ data: {}, error: { code: 'spam_risk_too_many_posts' } }),
      ) as never;
    await expect(new TiktokApiClient().creatorInfo('t')).rejects.toMatchObject({
      code: 'spam_risk_too_many_posts',
    });
  });

  it('reads creator_info fields', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      json({
        data: {
          creator_avatar_url: 'a',
          creator_username: 'u',
          creator_nickname: 'n',
          privacy_level_options: ['SELF_ONLY'],
          comment_disabled: true,
          duet_disabled: false,
          stitch_disabled: false,
          max_video_post_duration_sec: 300,
        },
        error: { code: 'ok' },
      }),
    ) as never;
    await expect(new TiktokApiClient().creatorInfo('t')).resolves.toEqual({
      username: 'u',
      nickname: 'n',
      avatarUrl: 'a',
      privacyLevelOptions: ['SELF_ONLY'],
      commentDisabled: true,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSec: 300,
    });
  });

  it('inits FILE_UPLOAD and refuses an upload URL off TikTok', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        json({
          data: {
            publish_id: 'p',
            upload_url: 'https://open-upload.tiktokapis.com/v?x',
          },
          error: { code: 'ok' },
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: { publish_id: 'p', upload_url: 'https://evil.example/v' },
          error: { code: 'ok' },
        }),
      );
    global.fetch = fetchMock as never;
    const client = new TiktokApiClient();
    const args = {
      accessToken: 't',
      videoSize: 1000,
      post: {
        title: 'x',
        privacyLevel: 'SELF_ONLY',
        disableComment: true,
        disableDuet: true,
        disableStitch: true,
      },
    };
    await expect(client.initDirectPost(args)).resolves.toEqual({
      publishId: 'p',
      uploadUrl: 'https://open-upload.tiktokapis.com/v?x',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.source_info).toEqual({
      source: 'FILE_UPLOAD',
      video_size: 1000,
      chunk_size: 1000,
      total_chunk_count: 1,
    });
    await expect(client.initDirectPost(args)).rejects.toBeInstanceOf(
      TiktokUploadFault,
    );
  });

  it('uploads a small file as one chunk and expects 201', async () => {
    const data = new Uint8Array(1000).fill(3);
    const put = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 201 }));
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(data, { headers: { 'content-length': '1000' } }),
      )
      .mockImplementation(put) as never;
    await new TiktokApiClient().uploadFromSource({
      uploadUrl: 'https://open-upload.tiktokapis.com/v?x',
      sourceUrl: 'https://signed/x',
      totalBytes: 1000,
      mimeType: 'video/mp4',
    });
    expect(put).toHaveBeenCalledTimes(1);
    const init = put.mock.calls[0][1];
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Range']).toBe('bytes 0-999/1000');
    expect(init.headers['Content-Length']).toBe('1000');
  });

  it('rejects a source whose size differs from the declared one', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(new Uint8Array(10), {
        headers: { 'content-length': '10' },
      }),
    ) as never;
    await expect(
      new TiktokApiClient().uploadFromSource({
        uploadUrl: 'https://open-upload.tiktokapis.com/v?x',
        sourceUrl: 'https://signed/x',
        totalBytes: 1000,
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'media_source_size_mismatch' });
  });

  it('maps errors into the failure vocabulary', () => {
    expect(
      tiktokFailure(new TiktokApiError(401, 'access_token_invalid')),
    ).toEqual({
      reason: 'credential_expired',
      code: 'tiktok_access_token_invalid',
    });
    expect(
      tiktokFailure(
        new TiktokApiError(
          403,
          'unaudited_client_can_only_post_to_private_accounts',
        ),
      ).reason,
    ).toBe('permission_lost');
    expect(tiktokFailure(new TiktokApiError(429, null)).reason).toBe(
      'rate_limited',
    );
    expect(tiktokFailure(new TiktokApiError(502, null)).reason).toBe(
      'provider_unavailable',
    );
    expect(tiktokFailure(new Error('x')).reason).toBe('provider_unavailable');
  });
});
