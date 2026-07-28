import {
  buildCorsOptions,
  CORS_ALLOWED_HEADERS,
  getAdminWebOrigins,
  getCorsAllowedOrigins,
} from './cors.config';

describe('CORS configuration', () => {
  it('allows the standard idempotency header used by browser mutations', () => {
    expect(
      CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()),
    ).toContain('idempotency-key');
  });

  it('adds configured Admin origins without removing Agency origins', () => {
    const environment = {
      CORS_ORIGINS: 'https://agency.lyra.example',
      ADMIN_WEB_ORIGIN: 'https://admin.lyra.example',
      NODE_ENV: 'production',
    };

    expect(getCorsAllowedOrigins(environment)).toEqual([
      'https://agency.lyra.example',
      'https://admin.lyra.example',
    ]);
    const options = buildCorsOptions(environment);
    expect(options.credentials).toBe(true);

    const callback = jest.fn();
    if (typeof options.origin === 'function') {
      options.origin('https://agency.lyra.example', callback);
    }
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('does not create an implicit production Admin origin', () => {
    expect(getAdminWebOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });

  it('denies an origin outside the exact allowlist', () => {
    const origin = buildCorsOptions({
      CORS_ORIGINS: 'https://agency.lyra.example',
      ADMIN_WEB_ORIGIN: 'https://admin.lyra.example',
      NODE_ENV: 'production',
    }).origin;
    const callback = jest.fn();

    expect(typeof origin).toBe('function');
    if (typeof origin === 'function') {
      origin('https://attacker.example', callback);
    }

    expect(callback).toHaveBeenCalledWith(null, false);
  });
});
