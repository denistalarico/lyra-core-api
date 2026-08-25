import { inspect } from 'node:util';
import {
  createResolvedAdCredential,
  summarizeCredential,
} from './resolved-ad-credential';

/**
 * Distinctive on purpose: every assertion below is "this string is nowhere in
 * that output", and a realistic-looking token would risk matching by accident.
 */
const SENTINEL = 'sentinel-token-0xDEADBEEF-never-print-me';

function credential() {
  return createResolvedAdCredential({
    connectionId: 'connection-id',
    tenantId: '11111111-1111-1111-1111-111111111111',
    workspaceId: '33333333-3333-3333-3333-333333333333',
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod: 'internal_system_user',
    externalAccountId: 'act_415877197389621',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    credentialVersion: 3,
    tokenExpiresAt: null,
    accessToken: SENTINEL,
  });
}

describe('ResolvedAdCredential', () => {
  it('hands the token to code that asks for it by name', () => {
    // The hiding must not make the object useless: this is the one access path
    // a reader is supposed to use.
    expect(credential().accessToken).toBe(SENTINEL);
  });

  describe('the token does not escape through a serializer', () => {
    it('is redacted by JSON.stringify', () => {
      const serialized = JSON.stringify(credential());

      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).toContain('[REDACTED]');
    });

    it('is dropped by spreading and by key enumeration', () => {
      const spread = { ...credential() } as Record<string, unknown>;

      expect(spread.accessToken).toBeUndefined();
      expect(Object.keys(credential())).not.toContain('accessToken');
      expect(JSON.stringify(spread)).not.toContain(SENTINEL);
    });

    it('is redacted by util.inspect, which is what console.log calls', () => {
      const printed = inspect(credential());

      expect(printed).not.toContain(SENTINEL);
      expect(printed).toContain('[REDACTED]');
    });

    it('is redacted by util.inspect even with showHidden', () => {
      // Non-enumerability alone loses this one: `showHidden` prints hidden
      // properties, which is exactly what a debug logger or a REPL asks for.
      // The custom inspection hook is what makes it hold.
      const printed = inspect(credential(), { showHidden: true, depth: null });

      expect(printed).not.toContain(SENTINEL);
      expect(printed).toContain('[REDACTED]');
    });

    it('is redacted when nested inside something else being logged', () => {
      // The realistic shape of the leak: nobody logs the credential, they log
      // the job it belongs to.
      const printed = inspect(
        { syncRun: { id: 'run-1', credential: credential() } },
        { showHidden: true, depth: null },
      );

      expect(printed).not.toContain(SENTINEL);
    });

    it('is absent from the summary used for logs and sync rows', () => {
      const summary = summarizeCredential(credential()) as Record<
        string,
        unknown
      >;

      expect(summary.accessToken).toBeUndefined();
      expect(inspect(summary, { showHidden: true })).not.toContain(SENTINEL);
    });
  });

  it('cannot be quietly rewritten by a caller', () => {
    const resolved = credential();

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(() => {
      (resolved as { tenantId: string }).tenantId = 'someone-else';
    }).toThrow();
  });
});
