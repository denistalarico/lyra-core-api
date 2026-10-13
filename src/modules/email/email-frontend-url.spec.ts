import { emailFrontendUrl } from './email-frontend-url';

describe('public frontend links in email', () => {
  const environment = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = environment;
  });
  it('defaults missing, blank or invalid configuration to the public site', () => {
    expect(emailFrontendUrl(undefined, '', 'invalid')).toBe(
      'https://lyrasuite.com',
    );
  });
  it('uses the product URL before the platform URL', () => {
    expect(
      emailFrontendUrl('https://agency.example.test/', 'https://lyrasuite.com'),
    ).toBe('https://agency.example.test');
  });
  it.each(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])(
    'skips %s in production',
    (host) => {
      process.env.NODE_ENV = 'production';
      expect(
        emailFrontendUrl(`http://${host}:3003`, 'https://lyrasuite.com'),
      ).toBe('https://lyrasuite.com');
      expect(emailFrontendUrl(`http://${host}:3003`)).toBe(
        'https://lyrasuite.com',
      );
    },
  );
  it('preserves explicitly configured dev links', () => {
    process.env.NODE_ENV = 'development';
    expect(emailFrontendUrl('http://localhost:3203')).toBe(
      'http://localhost:3203',
    );
  });
});
