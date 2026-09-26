import { streamMetaThumbnail } from './meta-thumbnail-proxy';

/**
 * The relay both thumbnail routes use, and the reason it is not a redirect.
 *
 * Every assertion here exists because the redirect version passed its own tests
 * completely. It answered `302` with a correctly resolved, correctly signed CDN
 * URL, and no picture ever reached a browser: the client authenticates with
 * headers, so it must use `fetch`; that makes the request CORS; the browser
 * follows the redirect still in CORS mode; and `scontent.*` answers with no
 * `Access-Control-Allow-Origin`. The response was discarded before any code
 * could see it. Nothing failed, nothing logged, and every thumbnail in the
 * product drew a placeholder.
 *
 * So these tests pin the two properties that failure had no way to express:
 * bytes come back under our own origin, and nothing of ours goes out to Meta.
 */
function fakeResponse() {
  const state = {
    statusCode: null as number | null,
    headers: {} as Record<string, string>,
    body: null as unknown,
    sent: null as Buffer | null,
  };

  const res = {
    setHeader(name: string, value: string | number) {
      state.headers[name] = String(value);
    },
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
    send(payload: Buffer) {
      state.sent = payload;
      return res;
    },
  };

  return Object.assign(state, { res: res as never });
}

function cdnReturning(init: {
  ok?: boolean;
  contentType?: string | null;
  body?: string;
}) {
  const headers = new Headers();

  if (init.contentType !== null) {
    headers.set('content-type', init.contentType ?? 'image/png');
  }

  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: init.ok ?? true,
    headers,
    arrayBuffer: () => Promise.resolve(Buffer.from(init.body ?? 'BYTES')),
  } as unknown as Response);
}

const URL_UNDER_TEST = 'https://scontent.example.test/pic.jpg?oe=DEADBEEF';

describe('streamMetaThumbnail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('relays the bytes rather than redirecting', async () => {
    const response = fakeResponse();
    cdnReturning({ body: 'IMAGE' });

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    expect(response.statusCode).toBe(200);
    expect(response.sent?.toString()).toBe('IMAGE');
  });

  it('serves the picture under the CDN’s own content type', async () => {
    const response = fakeResponse();
    cdnReturning({ contentType: 'image/webp' });

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // Guessing the type would be a second way to get this wrong: Meta serves
    // jpeg, png and webp from the same edge depending on the creative.
    expect(response.headers['Content-Type']).toBe('image/webp');
    expect(response.headers['Content-Length']).toBe(
      String(Buffer.from('BYTES').byteLength),
    );
  });

  it('sends no headers of ours to Meta', async () => {
    const response = fakeResponse();
    const cdn = cdnReturning({});

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // The signature is already in the URL. Forwarding the caller's bearer token
    // or managed-context headers would hand a Lyra credential to a third party
    // — which is the failure the original redirect design was built to avoid,
    // and it must not come back through the replacement.
    const init = cdn.mock.calls[0][1] as RequestInit;

    expect(init.headers).toBeUndefined();
    expect(cdn).toHaveBeenCalledWith(URL_UNDER_TEST, expect.anything());
  });

  it('marks the response private and unsniffable', async () => {
    const response = fakeResponse();
    cdnReturning({});

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // Private because the URL was resolved under one viewer's credential; short
    // because the signature expires on Meta's schedule regardless.
    expect(response.headers['Cache-Control']).toBe('private, max-age=300');
    // The bytes are Meta's but the origin is now Lyra's, so the browser must
    // not be free to interpret them as something other than an image.
    expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('refuses a response that is not an image', async () => {
    const response = fakeResponse();
    cdnReturning({ contentType: 'text/html', body: '<script>' });

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // A signed link that resolved to a document must not be relayed as
    // same-origin content just because it came from Meta.
    expect(response.statusCode).toBe(404);
    expect(response.sent).toBeNull();
  });

  it('refuses a response with no content type at all', async () => {
    const response = fakeResponse();
    cdnReturning({ contentType: null });

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    expect(response.statusCode).toBe(404);
    expect(response.sent).toBeNull();
  });

  it('treats a non-OK status as no picture', async () => {
    const response = fakeResponse();
    cdnReturning({ ok: false });

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // An expired signature is a 403 here, and it is an ordinary absence: the
    // row is about the numbers beside the picture.
    expect(response.statusCode).toBe(404);
  });

  it('never leaks the signed URL when the fetch throws', async () => {
    const response = fakeResponse();
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error(`ECONNRESET at ${URL_UNDER_TEST}`));

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // A transport error stringifies to the whole URL, signature included.
    // Re-throwing it would write a live credential into the logs.
    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('oe=DEADBEEF');
    expect(JSON.stringify(response.body)).not.toContain('ECONNRESET');
  });

  it('bounds the request in time', async () => {
    const response = fakeResponse();
    const cdn = cdnReturning({});

    await streamMetaThumbnail(URL_UNDER_TEST, response.res);

    // One static image from a CDN built to serve it in milliseconds, with a
    // caller that draws a placeholder the moment it fails. A request without a
    // deadline would hold a connection open for a row nobody is waiting on.
    const init = cdn.mock.calls[0][1] as RequestInit;

    expect(init.signal).toBeDefined();
  });
});
