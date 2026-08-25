import {
  DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET,
  SETTINGS_ENCRYPTION_KEY_ENV,
  SettingsCryptoService,
  SettingsEncryptionKeyError,
  resolveSettingsEncryptionSecret,
} from './settings-crypto.service';

describe('resolveSettingsEncryptionSecret', () => {
  it('uses the configured key outside production', () => {
    expect(
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'development',
        [SETTINGS_ENCRYPTION_KEY_ENV]: 'local-secret',
      }),
    ).toBe('local-secret');
  });

  it('falls back to the development secret when unset outside production', () => {
    expect(resolveSettingsEncryptionSecret({ NODE_ENV: 'test' })).toBe(
      DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET,
    );
  });

  it('falls back when the value is blank outside production', () => {
    expect(
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'development',
        [SETTINGS_ENCRYPTION_KEY_ENV]: '   ',
      }),
    ).toBe(DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET);
  });

  it('accepts a configured key in production', () => {
    expect(
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'production',
        [SETTINGS_ENCRYPTION_KEY_ENV]: 'a-private-production-secret',
      }),
    ).toBe('a-private-production-secret');
  });

  it('does not alter a production key that needs no trimming', () => {
    // The deployed key is derived through sha256; changing it by even one
    // character would make every stored credential undecryptable.
    const deployedShape = 'lyra_prod_31_chars_secret_key01';

    expect(
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'production',
        [SETTINGS_ENCRYPTION_KEY_ENV]: deployedShape,
      }),
    ).toBe(deployedShape);
  });

  it('fails closed in production when the key is missing', () => {
    expect(() =>
      resolveSettingsEncryptionSecret({ NODE_ENV: 'production' }),
    ).toThrow(SettingsEncryptionKeyError);
  });

  it('fails closed in production when the key is blank', () => {
    expect(() =>
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'production',
        [SETTINGS_ENCRYPTION_KEY_ENV]: '  ',
      }),
    ).toThrow(SettingsEncryptionKeyError);
  });

  it('rejects the development fallback in production', () => {
    expect(() =>
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'production',
        [SETTINGS_ENCRYPTION_KEY_ENV]: DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET,
      }),
    ).toThrow(SettingsEncryptionKeyError);
  });

  it('never names the configured value in the failure message', () => {
    let message = '';

    try {
      resolveSettingsEncryptionSecret({
        NODE_ENV: 'production',
        [SETTINGS_ENCRYPTION_KEY_ENV]: DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET,
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain(SETTINGS_ENCRYPTION_KEY_ENV);
    expect(message).not.toContain(DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET);
  });

  it('treats NODE_ENV case-insensitively', () => {
    expect(() =>
      resolveSettingsEncryptionSecret({ NODE_ENV: ' Production ' }),
    ).toThrow(SettingsEncryptionKeyError);
  });
});

describe('SettingsCryptoService', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousKey = process.env[SETTINGS_ENCRYPTION_KEY_ENV];

  afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousKey === undefined)
      delete process.env[SETTINGS_ENCRYPTION_KEY_ENV];
    else process.env[SETTINGS_ENCRYPTION_KEY_ENV] = previousKey;
  });

  it('round-trips a value', () => {
    process.env[SETTINGS_ENCRYPTION_KEY_ENV] = 'round-trip-key';
    const service = new SettingsCryptoService();

    const encrypted = service.encrypt('EAAG-super-secret-token');

    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toContain('EAAG-super-secret-token');
    expect(service.decrypt(encrypted)).toBe('EAAG-super-secret-token');
  });

  it('produces a different ciphertext for the same plaintext', () => {
    process.env[SETTINGS_ENCRYPTION_KEY_ENV] = 'round-trip-key';
    const service = new SettingsCryptoService();

    expect(service.encrypt('token')).not.toBe(service.encrypt('token'));
  });

  it('passes null and empty values through', () => {
    const service = new SettingsCryptoService();

    expect(service.encrypt(null)).toBeNull();
    expect(service.encrypt('')).toBeNull();
    expect(service.decrypt(null)).toBeNull();
    expect(service.decrypt('')).toBeNull();
  });

  it('cannot decrypt a payload written under another key', () => {
    process.env[SETTINGS_ENCRYPTION_KEY_ENV] = 'first-key';
    const encrypted = new SettingsCryptoService().encrypt('token');

    process.env[SETTINGS_ENCRYPTION_KEY_ENV] = 'second-key';

    expect(() => new SettingsCryptoService().decrypt(encrypted)).toThrow();
  });

  it('boots outside production without a configured key', () => {
    process.env.NODE_ENV = 'test';
    delete process.env[SETTINGS_ENCRYPTION_KEY_ENV];

    expect(() => new SettingsCryptoService().onModuleInit()).not.toThrow();
  });

  it('refuses to boot in production without a configured key', () => {
    process.env.NODE_ENV = 'production';
    delete process.env[SETTINGS_ENCRYPTION_KEY_ENV];

    expect(() => new SettingsCryptoService().onModuleInit()).toThrow(
      SettingsEncryptionKeyError,
    );
  });

  it('boots in production with a configured key', () => {
    process.env.NODE_ENV = 'production';
    process.env[SETTINGS_ENCRYPTION_KEY_ENV] = 'a-private-production-secret';

    expect(() => new SettingsCryptoService().onModuleInit()).not.toThrow();
  });
});
