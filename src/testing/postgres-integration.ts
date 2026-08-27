import {
  assertSafePostgresTarget,
  isPostgresIntegrationRequested,
} from './postgres-integration-guard';

/**
 * The gate every PostgreSQL-backed spec opens with.
 *
 * Replaces the line that used to be copied into each of these files:
 *
 * ```ts
 * const run = process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;
 * ```
 *
 * That line was correct about *whether* to run and silent about *where*. This
 * one answers both, and answering them in one place is the point — a spec
 * author cannot opt out of the check by forgetting it exists.
 *
 * The refusal is raised while the spec file is being evaluated, before any
 * `beforeAll` or `beforeEach` is registered, let alone executed. That is the
 * second line of defense; `jest-global-setup.ts` is the first and stops the
 * run before this file is even loaded. Both exist because the global setup can
 * be bypassed by a custom `--config`, and a spec can be run by a tool that
 * skips global setup entirely.
 */
export function describePostgresIntegration(): jest.Describe {
  if (!isPostgresIntegrationRequested()) {
    return describe.skip;
  }

  assertSafePostgresTarget();

  return describe;
}
