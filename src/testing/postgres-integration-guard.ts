/**
 * The barrier between a test's `DELETE` and the customer's data.
 *
 * On 2026-08-26 a gated integration run executed `TRUNCATE ... CASCADE`
 * against `lyra_agency` — production — and destroyed the Inbox channels, the
 * LeadFlow agents and automations, and the Agency contacts and CRM
 * opportunities. Nothing in the code objected, because nothing in the code
 * knew which database it was pointed at. The specs asked for
 * `AgencyDataSource`, `AgencyDataSource` read `AGENCY_DB_NAME ?? 'lyra_agency'`,
 * and the default did the rest.
 *
 * This module exists so that the same command aborts instead.
 *
 * **Fail-closed, and deliberately not clever.** The guard does not try to
 * detect production; it demands proof of *disposability*. A database is
 * acceptable only when it is named explicitly and its name ends in `_test` or
 * `_dev` — the two suffixes this repository already uses for databases that
 * `scripts/refresh-dev-databases.sh` is willing to drop and rebuild. Anything
 * else — a missing variable, an unfamiliar name, a name that merely looks
 * harmless — is refused. The failure mode of a wrong guess is asymmetric:
 * refusing a legitimate database costs one environment variable, and admitting
 * a production one costs what it cost today.
 *
 * **`NODE_ENV` is not consulted, on purpose.** `NODE_ENV=test` with
 * `AGENCY_DB_NAME=lyra_agency` is precisely the combination that would still
 * destroy production, and it is the combination a developer is most likely to
 * produce by accident. The target is what matters, so the target is what is
 * checked.
 */

/** The flag every PostgreSQL-backed spec is gated behind. */
export const POSTGRES_INTEGRATION_FLAG = 'INBOX_PG_INTEGRATION';

/**
 * Names that are never acceptable, whatever else is true about them.
 *
 * Redundant with the suffix rule — neither ends in `_test` or `_dev` — and kept
 * anyway, because this list is the part a reader checks when they ask "is
 * production named here?", and because a future suffix policy change must not
 * silently unlock these two.
 */
const PRODUCTION_DATABASES = ['lyra_agency', 'lyra_core'];

/** The only suffixes that mark a database as safe to write to and wipe. */
const DISPOSABLE_SUFFIXES = ['_test', '_dev'];

/**
 * Every variable that can end up as a `database:` in a DataSource the specs
 * touch. `AGENCY_DB_NAME` is the one that mattered today; `DB_NAME` is checked
 * too because it is the other database this cluster serves, and a spec that
 * reaches for the core DataSource tomorrow should not have to remember to add
 * itself here.
 */
const GUARDED_VARIABLES = ['AGENCY_DB_NAME', 'DB_NAME'] as const;

const HEADLINE =
  'Refusing to run PostgreSQL integration tests against a production database.';

export class ProductionDatabaseRefusalError extends Error {
  constructor(
    readonly variable: string,
    readonly reason: 'missing' | 'production' | 'not_disposable',
    message: string,
  ) {
    super(message);
    this.name = 'ProductionDatabaseRefusalError';
  }
}

/** Whether the caller asked for the database-backed specs at all. */
export function isPostgresIntegrationRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[POSTGRES_INTEGRATION_FLAG] === 'true';
}

function refuse(
  variable: string,
  reason: 'missing' | 'production' | 'not_disposable',
  detail: string,
): never {
  throw new ProductionDatabaseRefusalError(
    variable,
    reason,
    [
      HEADLINE,
      `  ${variable}: ${detail}`,
      `  A PostgreSQL integration run must name its database explicitly, and`,
      `  that name must end in ${DISPOSABLE_SUFFIXES.join(' or ')}.`,
      `  Use "pnpm test:postgres", which loads .env.test for you.`,
      `  Never source the production .env for these specs.`,
    ].join('\n'),
  );
}

/**
 * Refuse unless this one variable names a database that may be destroyed.
 *
 * Comparison is case-insensitive because Postgres folds unquoted identifiers,
 * so `LYRA_AGENCY` and `lyra_agency` reach the same rows.
 */
export function assertDisposableDatabase(
  variable: string,
  value: string | undefined,
): void {
  const name = value?.trim();

  if (!name) {
    // The dangerous case is not an error here but a *default* downstream:
    // `AGENCY_DB_NAME ?? 'lyra_agency'`. Absence must therefore be as fatal as
    // naming production outright, or the fallback simply reintroduces it.
    refuse(
      variable,
      'missing',
      'is not set, and the DataSource default for it is a production database',
    );
  }

  const normalized = name.toLowerCase();

  if (PRODUCTION_DATABASES.includes(normalized)) {
    refuse(variable, 'production', `is "${name}", which is production`);
  }

  if (!DISPOSABLE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    refuse(
      variable,
      'not_disposable',
      `is "${name}", which is not recognizable as a disposable database`,
    );
  }
}

/** Refuse unless every guarded variable names a disposable database. */
export function assertSafePostgresTarget(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const variable of GUARDED_VARIABLES) {
    assertDisposableDatabase(variable, env[variable]);
  }
}

/**
 * The form the runtime actually calls: check only when the gate is open.
 *
 * A normal `jest` run touches no database and must stay unaffected, so an
 * unset flag is not an error — it is the ordinary case.
 */
export function assertSafePostgresTargetIfRequested(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isPostgresIntegrationRequested(env)) {
    assertSafePostgresTarget(env);
  }
}
