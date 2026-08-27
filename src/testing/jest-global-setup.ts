import { assertSafePostgresTargetIfRequested } from './postgres-integration-guard';

/**
 * The earliest point at which this repository can say no.
 *
 * Jest runs `globalSetup` once, in the parent process, before it reads a
 * single test file. Throwing here aborts the entire run — no worker starts, no
 * spec is required, no DataSource is constructed, and no SQL is sent. That
 * ordering is the whole point: a guard inside a spec would already be one
 * `import` away from a module that opens a connection.
 *
 * It lives in `src/testing` rather than `test/` because `rootDir` is `src`,
 * and a `globalSetup` outside `rootDir` is not covered by the ts-jest
 * transform. `testRegex` only matches `*.spec.ts`, so this file is never
 * collected as a suite.
 */
export default function globalSetup(): void {
  assertSafePostgresTargetIfRequested();
}
