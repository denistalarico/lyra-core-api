/**
 * The decorator polyfill every worker needs before it requires a spec.
 *
 * `class-transformer` and `class-validator` call `Reflect.getMetadata` while
 * the decorator itself evaluates — that is, at import time of any DTO. In the
 * application this is covered because `main.ts` and the DataSource both import
 * `reflect-metadata` first, but a spec that reaches a decorated DTO through
 * some other module gets there without the polyfill and fails to even load.
 *
 * Jest runs `setupFiles` in each worker before the test framework installs and
 * before any spec is required, so loading it here makes import order inside a
 * spec irrelevant. `testRegex` only matches `*.spec.ts`, so this file is never
 * collected as a suite.
 */
import 'reflect-metadata';
