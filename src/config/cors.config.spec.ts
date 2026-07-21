import { CORS_ALLOWED_HEADERS } from './cors.config';

describe('CORS configuration', () => {
  it('allows the standard idempotency header used by browser mutations', () => {
    expect(
      CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()),
    ).toContain('idempotency-key');
  });
});
