import { SsrfSafeUrlFetcherService } from './ssrf-safe-url-fetcher.service';

const OPTS = { maxBytes: 1024 * 1024, timeoutMs: 2000 };

describe('SsrfSafeUrlFetcherService (real IP guard — nothing here should ever connect)', () => {
  const service = new SsrfSafeUrlFetcherService();

  it('rejects a loopback URL before making any request', async () => {
    await expect(service.fetchUrl('http://127.0.0.1/', OPTS)).rejects.toThrow(
      /disallowed network address/,
    );
  });

  it('rejects a link-local (cloud metadata) URL', async () => {
    await expect(service.fetchUrl('http://169.254.169.254/latest/meta-data/', OPTS)).rejects.toThrow(
      /disallowed network address/,
    );
  });

  it('rejects a private RFC1918 URL', async () => {
    await expect(service.fetchUrl('http://10.0.0.5/', OPTS)).rejects.toThrow(
      /disallowed network address/,
    );
  });

  it('rejects a non-http(s) scheme', async () => {
    await expect(service.fetchUrl('file:///etc/passwd', OPTS)).rejects.toThrow(
      /Only http\(s\) URLs are allowed/,
    );
  });

  it('rejects a non-default port (blocks internal port scanning)', async () => {
    await expect(service.fetchUrl('http://93.184.216.34:6379/', OPTS)).rejects.toThrow(
      /Only default HTTP\(S\) ports are allowed/,
    );
  });

  it('rejects a malformed URL', async () => {
    await expect(service.fetchUrl('not a url', OPTS)).rejects.toThrow(/Invalid URL/);
  });
});
