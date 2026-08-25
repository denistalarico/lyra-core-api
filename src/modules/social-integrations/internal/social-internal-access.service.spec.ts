import { NotFoundException } from '@nestjs/common';
import { SocialInternalAccessService } from './social-internal-access.service';

const INTERNAL_TENANT = '3fcf6e35-9881-4713-b704-795956eec0c8';
const OTHER_TENANT = '8a2c1d44-0000-4000-8000-0000000000ff';
const TOKEN = 'system-user-token-value';
const INTERNAL_ACCOUNT = 'act_415877197389621';

const INTERNAL_SCOPE = { tenantId: INTERNAL_TENANT, agencyClientId: null };

describe('SocialInternalAccessService', () => {
  const originalEnv = process.env;
  let service: SocialInternalAccessService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_ADS_INTERNAL_TENANT_ID: INTERNAL_TENANT,
      SOCIAL_META_ADS_SYSTEM_USER_TOKEN: TOKEN,
      SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID: INTERNAL_ACCOUNT,
    };
    service = new SocialInternalAccessService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows the configured internal tenant in its own agency context', () => {
    expect(
      service.isInternalScope({
        tenantId: INTERNAL_TENANT,
        agencyClientId: null,
      }),
    ).toBe(true);
  });

  it('refuses every other tenant', () => {
    expect(
      service.isInternalScope({ tenantId: OTHER_TENANT, agencyClientId: null }),
    ).toBe(false);

    expect(() =>
      service.requireSystemUserToken({
        tenantId: OTHER_TENANT,
        agencyClientId: null,
      }),
    ).toThrow(NotFoundException);
  });

  it('refuses a managed client inside the internal tenant', () => {
    // The System User can read every account in the agency's Business Manager.
    // Lending it to a client context would hand one client all of them.
    expect(
      service.isInternalScope({
        tenantId: INTERNAL_TENANT,
        agencyClientId: 'client-a',
      }),
    ).toBe(false);
  });

  it('disables the exception entirely when no internal tenant is configured', () => {
    delete process.env.SOCIAL_META_ADS_INTERNAL_TENANT_ID;
    const unconfigured = new SocialInternalAccessService();

    // The dangerous failure would be an empty string matching an empty tenant,
    // or the absence of configuration being read as "everyone".
    expect(
      unconfigured.isInternalScope({ tenantId: '', agencyClientId: null }),
    ).toBe(false);
    expect(
      unconfigured.isInternalScope({
        tenantId: INTERNAL_TENANT,
        agencyClientId: null,
      }),
    ).toBe(false);
  });

  it('is unavailable when the token is missing, even for the internal tenant', () => {
    delete process.env.SOCIAL_META_ADS_SYSTEM_USER_TOKEN;
    const withoutToken = new SocialInternalAccessService();
    const scope = { tenantId: INTERNAL_TENANT, agencyClientId: null };

    expect(withoutToken.isInternalScope(scope)).toBe(true);
    expect(withoutToken.isAvailable(scope)).toBe(false);
  });

  it('names the variable when the token is missing, never a piece of it', () => {
    delete process.env.SOCIAL_META_ADS_SYSTEM_USER_TOKEN;
    const withoutToken = new SocialInternalAccessService();

    expect(() =>
      withoutToken.requireSystemUserToken({
        tenantId: INTERNAL_TENANT,
        agencyClientId: null,
      }),
    ).toThrow('SOCIAL_META_ADS_SYSTEM_USER_TOKEN is not configured.');
  });

  it('answers not found rather than forbidden', () => {
    // "Forbidden" would tell every other tenant that an internal path exists
    // and that somebody else is allowed down it.
    try {
      service.requireInternalScope({
        tenantId: OTHER_TENANT,
        agencyClientId: null,
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect(JSON.stringify(error)).not.toContain(INTERNAL_TENANT);
    }
  });

  it('returns the token only to the internal scope', () => {
    expect(
      service.requireSystemUserToken({
        tenantId: INTERNAL_TENANT,
        agencyClientId: null,
      }),
    ).toBe(TOKEN);
  });

  describe('the configured account', () => {
    it('is returned in canonical form to the internal scope', () => {
      expect(service.requireInternalAccountId(INTERNAL_SCOPE)).toBe(
        INTERNAL_ACCOUNT,
      );
    });

    it('is canonicalized from the bare number Meta also uses', () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = '415877197389621';
      const bare = new SocialInternalAccessService();

      // An operator who copies the account id out of the Meta UI without the
      // prefix has configured the same account, not a broken one.
      expect(bare.requireInternalAccountId(INTERNAL_SCOPE)).toBe(
        INTERNAL_ACCOUNT,
      );
      expect(bare.isAvailable(INTERNAL_SCOPE)).toBe(true);
    });

    it('is never handed to another tenant', () => {
      expect(() =>
        service.requireInternalAccountId({
          tenantId: OTHER_TENANT,
          agencyClientId: null,
        }),
      ).toThrow(NotFoundException);

      expect(() =>
        service.requireInternalAccountId({
          tenantId: INTERNAL_TENANT,
          agencyClientId: 'client-a',
        }),
      ).toThrow(NotFoundException);
    });

    it('disables only the internal method when it is missing', () => {
      delete process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID;
      const withoutAccount = new SocialInternalAccessService();

      expect(withoutAccount.isAvailable(INTERNAL_SCOPE)).toBe(false);
      expect(() =>
        withoutAccount.requireInternalAccountId(INTERNAL_SCOPE),
      ).toThrow('SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID is not configured.');
    });

    it('reads only its own three variables, never the OAuth ones', () => {
      // Recorded rather than asserted by eye: "the internal gate does not
      // touch the OAuth configuration" is the property that keeps a missing
      // internal account from disabling anything but the internal method.
      const read = new Set<string>();
      const env = process.env;

      process.env = new Proxy(env, {
        get(target, key: string) {
          read.add(key);
          return target[key];
        },
      });

      try {
        const observed = new SocialInternalAccessService();
        observed.isAvailable(INTERNAL_SCOPE);
        observed.requireSystemUserToken(INTERNAL_SCOPE);
        observed.requireInternalAccountId(INTERNAL_SCOPE);
      } finally {
        process.env = env;
      }

      expect([...read].filter((key) => key.startsWith('SOCIAL_'))).toEqual(
        expect.arrayContaining([
          'SOCIAL_META_ADS_INTERNAL_TENANT_ID',
          'SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID',
          'SOCIAL_META_ADS_SYSTEM_USER_TOKEN',
        ]),
      );
      expect(read).not.toContain('SOCIAL_META_ADS_APP_ID');
      expect(read).not.toContain('SOCIAL_META_ADS_APP_SECRET');
      expect(read).not.toContain('SOCIAL_META_ADS_LOGIN_CONFIG_ID');
    });

    it('tells a malformed value apart from a missing one', () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = 'act_not-an-id';
      const malformed = new SocialInternalAccessService();

      expect(malformed.isAvailable(INTERNAL_SCOPE)).toBe(false);
      expect(() => malformed.requireInternalAccountId(INTERNAL_SCOPE)).toThrow(
        'SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID is not a valid Meta ad account id.',
      );
    });

    it('never echoes the configured value in the failure', () => {
      process.env.SOCIAL_META_ADS_INTERNAL_ACCOUNT_ID = 'act_not-an-id';
      const malformed = new SocialInternalAccessService();

      try {
        malformed.requireInternalAccountId(INTERNAL_SCOPE);
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).not.toContain('act_not-an-id');
      }
    });
  });
});
