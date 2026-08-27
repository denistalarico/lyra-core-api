import {
  ProductionDatabaseRefusalError,
  assertDisposableDatabase,
  assertSafePostgresTarget,
  assertSafePostgresTargetIfRequested,
  isPostgresIntegrationRequested,
} from './postgres-integration-guard';

/**
 * The guard is the only thing that would have stopped the 2026-08-26 incident,
 * so these tests are written as the incident itself: the exact environment that
 * caused it must refuse.
 *
 * No database is touched here — that is the point. The guard decides from
 * environment variables alone, before anything opens a connection.
 */
describe('postgres integration guard', () => {
  const safe = {
    INBOX_PG_INTEGRATION: 'true',
    AGENCY_DB_NAME: 'lyra_agency_dev',
    DB_NAME: 'lyra_core_dev',
  } as NodeJS.ProcessEnv;

  describe('the environment that destroyed production', () => {
    it('refuses lyra_agency', () => {
      // Verbatim: what `set -a; . ./.env; set +a` exports.
      const env = {
        INBOX_PG_INTEGRATION: 'true',
        AGENCY_DB_NAME: 'lyra_agency',
        DB_NAME: 'lyra_core',
      } as NodeJS.ProcessEnv;

      expect(() => assertSafePostgresTargetIfRequested(env)).toThrow(
        ProductionDatabaseRefusalError,
      );
      expect(() => assertSafePostgresTargetIfRequested(env)).toThrow(
        'Refusing to run PostgreSQL integration tests against a production database.',
      );
    });

    it('names the offending variable and the reason', () => {
      try {
        assertDisposableDatabase('AGENCY_DB_NAME', 'lyra_agency');
        throw new Error('expected a refusal');
      } catch (error) {
        const refusal = error as ProductionDatabaseRefusalError;
        expect(refusal.variable).toBe('AGENCY_DB_NAME');
        expect(refusal.reason).toBe('production');
      }
    });

    it('refuses lyra_agency however it is cased', () => {
      // Postgres folds unquoted identifiers, so LYRA_AGENCY reaches the same
      // rows. A case-sensitive deny list would be a hole, not a policy.
      expect(() =>
        assertDisposableDatabase('AGENCY_DB_NAME', 'LYRA_AGENCY'),
      ).toThrow(ProductionDatabaseRefusalError);
    });

    it('refuses production even when NODE_ENV claims this is a test', () => {
      // The combination the guard exists for: the process believes it is a
      // test run and is still pointed at customer data.
      const env = {
        NODE_ENV: 'test',
        INBOX_PG_INTEGRATION: 'true',
        AGENCY_DB_NAME: 'lyra_agency',
        DB_NAME: 'lyra_core_dev',
      } as NodeJS.ProcessEnv;

      expect(() => assertSafePostgresTargetIfRequested(env)).toThrow(
        ProductionDatabaseRefusalError,
      );
    });
  });

  describe('absence', () => {
    it('refuses when AGENCY_DB_NAME is unset', () => {
      // Unset is the dangerous case, not the neutral one: the DataSource
      // resolves `AGENCY_DB_NAME ?? "lyra_agency"`, so silence means production.
      const env = {
        INBOX_PG_INTEGRATION: 'true',
        DB_NAME: 'lyra_core_dev',
      } as NodeJS.ProcessEnv;

      expect(() => assertSafePostgresTargetIfRequested(env)).toThrow(
        /AGENCY_DB_NAME: is not set/,
      );
    });

    it('refuses when DB_NAME is unset', () => {
      const env = {
        INBOX_PG_INTEGRATION: 'true',
        AGENCY_DB_NAME: 'lyra_agency_dev',
      } as NodeJS.ProcessEnv;

      expect(() => assertSafePostgresTargetIfRequested(env)).toThrow(
        /DB_NAME: is not set/,
      );
    });

    it('refuses an empty string, which is not a name', () => {
      expect(() => assertDisposableDatabase('AGENCY_DB_NAME', '   ')).toThrow(
        ProductionDatabaseRefusalError,
      );
    });
  });

  describe('names that prove nothing', () => {
    it('refuses a database whose name carries no disposable suffix', () => {
      // Not on the deny list, and still refused: the guard demands proof of
      // disposability rather than trying to recognize production.
      expect(() =>
        assertDisposableDatabase('AGENCY_DB_NAME', 'lyra_agency_backup'),
      ).toThrow(/not recognizable as a disposable database/);
    });

    it('refuses a name that merely contains _dev in the middle', () => {
      expect(() =>
        assertDisposableDatabase('AGENCY_DB_NAME', 'lyra_dev_agency'),
      ).toThrow(ProductionDatabaseRefusalError);
    });
  });

  describe('the databases the tests are meant to use', () => {
    it('admits _dev and _test targets', () => {
      expect(() => assertSafePostgresTarget(safe)).not.toThrow();
      expect(() =>
        assertSafePostgresTarget({
          AGENCY_DB_NAME: 'lyra_agency_test',
          DB_NAME: 'lyra_core_test',
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  describe('runs that ask for no database', () => {
    it('leaves an ordinary jest run alone, production names and all', () => {
      // `pnpm test` must stay usable on a machine whose shell happens to hold
      // production variables: without the flag, no spec opens a connection.
      const env = {
        AGENCY_DB_NAME: 'lyra_agency',
        DB_NAME: 'lyra_core',
      } as NodeJS.ProcessEnv;

      expect(isPostgresIntegrationRequested(env)).toBe(false);
      expect(() => assertSafePostgresTargetIfRequested(env)).not.toThrow();
    });

    it('treats any value other than the literal "true" as off', () => {
      expect(
        isPostgresIntegrationRequested({
          INBOX_PG_INTEGRATION: '1',
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });
  });
});
