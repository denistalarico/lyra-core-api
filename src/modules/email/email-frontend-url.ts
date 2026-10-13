/** Public links in emails must remain usable when a product URL is unset. */
export function emailFrontendUrl(
  ...candidates: (string | undefined)[]
): string {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const url = new URL(candidate.trim());
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      const local =
        ['localhost', '[::1]', '0.0.0.0'].includes(url.hostname) ||
        /^127\./.test(url.hostname) ||
        url.hostname.endsWith('.localhost');
      if (process.env.NODE_ENV === 'production' && local) continue;
      return url.href.replace(/\/$/, '');
    } catch {
      // Try the next configured product/platform URL.
    }
  }
  return 'https://lyrasuite.com';
}
