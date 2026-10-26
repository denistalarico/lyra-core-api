/** A filename an operator can find again in a downloads folder. */
export function analyticsReportFilename(
  title: string,
  since: string,
  until: string,
): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'relatorio';

  return `${slug}-${since}-${until}.pdf`;
}

/** The IANA zone frozen on an emission; anything unknown becomes UTC. */
export function normalizeReportTimezone(value: string | undefined): string {
  const timezone = value?.trim() || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

/**
 * What the report may load while Chromium renders it.
 *
 * The body is operator-supplied markup, so by default nothing is fetched: the
 * client inlines every image it can as a `data:` URI, and those never touch the
 * network. Two exceptions remain. The agency logo is a URL of this API, allowed
 * exactly. Meta's CDN serves the reel thumbnails the browser could not inline
 * (it does not send CORS headers), and is allowed by host, over HTTPS only.
 * Everything else, internal addresses included, is refused.
 */
export function isAllowedReportRequest(
  url: string,
  logoUrl: string | null,
): boolean {
  if (logoUrl && url === logoUrl) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();

  return META_CDN_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

const META_CDN_HOSTS = ['fbcdn.net', 'cdninstagram.com'];
