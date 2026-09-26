import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * How long the CDN has to answer before the picture is given up on.
 *
 * Shorter than a Graph call's budget: this is one static image from a CDN
 * designed to serve it in milliseconds, and the caller is a table cell that
 * draws a placeholder the moment this fails. A long timeout here would hold a
 * connection open for a row nobody is waiting on.
 */
const THUMBNAIL_TIMEOUT_MS = 8_000;

/**
 * Only real pictures are relayed.
 *
 * The URL came from Meta, but this process is about to fetch it and hand the
 * bytes to a browser under Lyra's own origin. Restricting the relay to image
 * types means a URL that somehow resolved to HTML or JSON cannot be served as
 * same-origin content — which is the difference between proxying a picture and
 * proxying whatever a signed link happens to point at today.
 */
const ALLOWED_PREFIX = 'image/';

/**
 * Streams a Meta-hosted thumbnail through this process to the browser.
 *
 * **This exists because a redirect cannot work here, although it looks like it
 * should.** Both thumbnail endpoints originally answered `302` with the signed
 * CDN URL, on the sound reasoning that the browser should fetch the picture
 * itself and the access token should never leave the server. The token half was
 * right. The delivery half could never have worked:
 *
 * The front end cannot use a plain `<img src>` here — authentication travels in
 * headers (bearer token plus the managed-context headers) and a browser sends
 * none of those with an image request, so the tag gets a 401. So the client
 * calls `fetch()`, which makes it a **CORS** request. The browser follows the
 * 302 still in CORS mode, arrives at `scontent.*`, and Meta's CDN answers with
 * no `Access-Control-Allow-Origin` header at all — verified directly against
 * the CDN. The browser therefore blocks the response before any code sees it:
 * `response.ok` is never reached, the client's `.catch()` runs, and every
 * thumbnail in the product draws its "no image" placeholder.
 *
 * Nothing logged an error. The endpoint returned 302 correctly, the service
 * resolved the URL correctly, every test passed, and the pictures were simply
 * never visible.
 *
 * Proxying the bytes is what makes the response same-origin, which is the only
 * thing the browser will accept from a `fetch` it had to authenticate. The cost
 * is that image data now passes through this process; the timeout above and the
 * content-type check below are what keep that bounded.
 *
 * Still stores nothing. Meta signs these URLs with a ~5 day expiry, so the URL
 * is resolved per request and the bytes are forwarded, never written down.
 *
 * Returns nothing and writes the response itself, including on failure: a
 * thumbnail that cannot be fetched is a `404` and a placeholder, never an error
 * that fails the page whose subject is the numbers beside it.
 */
export async function streamMetaThumbnail(
  url: string,
  response: Response,
): Promise<void> {
  let upstream: globalThis.Response;

  try {
    upstream = await fetch(url, {
      method: 'GET',
      // No credentials of ours: the signature is already in the URL, and a
      // header meant for Lyra's API has no business reaching Meta's CDN.
      signal: timeoutSignal(),
    });
  } catch {
    // The provider's own error is never re-thrown — a transport failure
    // stringifies to the full signed URL, which would put a live credential in
    // the logs.
    notFound(response);
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? '';

  if (!upstream.ok || !contentType.startsWith(ALLOWED_PREFIX)) {
    notFound(response);
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());

  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', body.byteLength);
  // Private and short, as when this was a redirect: the picture is scoped to
  // this viewer's credential, so a shared cache must not hand it to another
  // tenant, and the signed URL behind it expires on its own schedule anyway.
  response.setHeader('Cache-Control', 'private, max-age=300');
  // The bytes are Meta's, served from Lyra's origin. Without this a page that
  // embedded the response could be told to sniff it as something else.
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.status(HttpStatus.OK).send(body);
}

/** The one absence this endpoint has: there is no picture to show. */
export function notFound(response: Response): void {
  response.status(HttpStatus.NOT_FOUND).json({ message: 'Not found.' });
}

/**
 * Guarded rather than called directly, matching `MetaAdsGraphService`: a
 * runtime without `AbortSignal.timeout` should still make the request rather
 * than fail on a missing platform API.
 */
function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS)
    : undefined;
}
