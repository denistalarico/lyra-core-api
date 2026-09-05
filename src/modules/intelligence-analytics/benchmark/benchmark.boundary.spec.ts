import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * The boundary that keeps anonymous learning optional (§32, §36).
 *
 * Two directions, and both matter.
 *
 * **Operational analytics must not depend on the benchmark.** Turning the gate
 * off, revoking every consent or deleting every contribution must leave I3, I4,
 * Social Analytics, LeadFlow Analytics and Business Mode working exactly as they
 * do today. The way that guarantee dies is quietly — a service imports the
 * benchmark for one enrichment, and a year later disabling telemetry breaks a
 * dashboard nobody connected to it.
 *
 * **The benchmark must not read individual attribution.** I4 resolves a specific
 * conversation to a specific ad. Nothing in it may reach a cross-tenant
 * aggregate: those records carry conversation and ad identifiers, and an
 * aggregate built from them would carry the linkage even if the numbers looked
 * anonymous.
 *
 * Both are checked by reading source rather than by a runtime test, because a
 * runtime test can only prove that the dependency is absent *today* on the path
 * it happened to exercise.
 */
const MODULE_ROOT = join(__dirname, '..', '..');

const BENCHMARK_FILES = readdirSync(__dirname)
  .filter((file) => file.endsWith('.ts'))
  .filter((file) => !file.endsWith('.spec.ts'));

const readCode = (path: string) => readFileSync(path, 'utf8');

/** Every `.ts` under a module, recursively, excluding specs. */
const sourcesUnder = (relative: string): string[] => {
  const root = join(MODULE_ROOT, relative);
  const found: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        found.push(path);
      }
    }
  };

  walk(root);

  return found;
};

describe('benchmark boundary', () => {
  /**
   * The operational modules, named by the decisions.
   *
   * `intelligence-analytics` is excluded from this sweep because the benchmark
   * lives inside it; its operational siblings are checked individually below.
   */
  const OPERATIONAL_MODULES = [
    'social-integrations',
    'leadflow-analytics',
    'leadflow-privacy',
    'platform-privacy',
    'crm',
    'inbox',
  ];

  /**
   * The rule is about *imports*, not about vocabulary.
   *
   * It was originally written as a substring search, which was adequate while no
   * operational module had any reason to mention the benchmark. I6.1 changed
   * that: `leadflow-privacy` now documents, at length, why it must not import
   * Intelligence — and the substring check failed on the explanation of the rule
   * it exists to enforce, whose obvious "fix" is to delete the reasoning.
   *
   * Import specifiers are what actually couple two modules, so that is what is
   * matched. The class names are still checked, but as *usages* — a type
   * position, a constructor argument, a `new` — rather than as text.
   */
  const importSpecifiers = (source: string): string[] =>
    [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

  /** Code with comments stripped, so prose cannot trip a name check. */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it.each(OPERATIONAL_MODULES)(
    '%s does not import the benchmark',
    (moduleName) => {
      for (const path of sourcesUnder(moduleName)) {
        const source = readCode(path);

        for (const specifier of importSpecifiers(source)) {
          expect(specifier).not.toMatch(/intelligence-analytics/);
          expect(specifier).not.toMatch(/benchmark/);
        }

        const code = withoutComments(source);

        expect(code).not.toContain('BenchmarkService');
        expect(code).not.toContain('PaidMediaContributionService');
        expect(code).not.toContain('PaidMediaContributionAdapter');
      }
    },
  );

  /**
   * The contribution arrow points into privacy, and only that way.
   *
   * This is the invariant I6.1 rests on. The consent owner must be constructible
   * without Social or LeadFlow analytics in the graph — otherwise the module
   * that decides whether anything may be collected cannot start unless the
   * modules it polices are present, and "telemetry is optional" stops being
   * true structurally.
   *
   * Checked from the privacy side rather than by booting a graph: a runtime
   * boot proves the wiring works today, not that it stays acyclic.
   */
  it('lets the privacy module resolve without Intelligence', () => {
    const registry = readCode(
      join(
        MODULE_ROOT,
        'leadflow-privacy',
        'services',
        'telemetry-contribution.port.ts',
      ),
    );

    // The port depends on the privacy module's own types and nothing else.
    for (const specifier of importSpecifiers(registry)) {
      expect(specifier.startsWith('../')).toBe(true);
      expect(specifier).not.toMatch(/modules\//);
    }
  });

  /**
   * A contributing domain cannot persist, and cannot check its own consent.
   *
   * §2: the builder produces candidate rows and the collector decides. An
   * adapter that reached for a consent repository would be deciding for itself.
   */
  it('keeps the contribution adapter powerless', () => {
    const source = readCode(
      join(__dirname, 'paid-media-contribution.adapter.ts'),
    );
    const code = withoutComments(source);

    for (const forbidden of [
      'leadflow_telemetry_consents',
      'leadflow_telemetry_consent_notices',
      'leadflow_product_telemetry_daily',
      'leadflow_telemetry_identity_links',
      'scopePseudonym',
      'LEADFLOW_PRODUCT_TELEMETRY_ENABLED',
      'randomUUID',
    ]) {
      expect(code).not.toContain(forbidden);
    }

    for (const statement of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\bDELETE\s+FROM\b/i,
    ]) {
      expect(code).not.toMatch(statement);
    }
  });

  /**
   * The operational reads inside this very module stay independent too.
   *
   * I3 (`acquisition-cohort`) and I4 (`observed-attribution*`) sit beside the
   * benchmark and are the ones most at risk of an accidental import, precisely
   * because they are one directory away.
   */
  it.each([
    'acquisition-cohort.service.ts',
    'acquisition-cohort.controller.ts',
    'observed-attribution.service.ts',
    'observed-attribution.controller.ts',
    'observed-attribution-summary.service.ts',
    'observed-attribution-summary.controller.ts',
  ])('%s does not depend on the benchmark', (file) => {
    const source = readCode(join(MODULE_ROOT, 'intelligence-analytics', file));

    expect(source).not.toContain('benchmark');
    expect(source).not.toContain('Benchmark');
  });

  /**
   * The gate is read in one place only.
   *
   * A second flag would mean a deployment where contribution is off and
   * benchmarking is on, or the reverse — states nobody intends and nothing
   * describes.
   */
  it('reads the existing telemetry gate and defines no parallel one', () => {
    for (const file of BENCHMARK_FILES) {
      const source = readCode(join(__dirname, file));
      const gateReferences = source.match(/process\.env\.[A-Z_]+/g) ?? [];

      for (const reference of gateReferences) {
        expect([
          'process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED',
          'process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY',
        ]).toContain(reference);
      }
    }
  });

  /**
   * §36: no I4 identifier may reach a benchmark.
   *
   * The read path must never name the attribution tables, and the write path
   * must never select an identifier out of them.
   */
  it('never reads individual attribution', () => {
    for (const file of BENCHMARK_FILES) {
      const source = readCode(join(__dirname, file));

      for (const forbidden of [
        'inbox_attribution_observations',
        'inbox_conversations',
        'inbox_messages',
        'crm_opportunities',
        'ObservedAttributionService',
        'AcquisitionCohortService',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  /**
   * The read path touches the anonymous fact table and nothing else.
   *
   * The contribution builder legitimately reads Social's own tables — that is
   * the write side, scoped to a single consenting context — so the assertion is
   * scoped to the reader.
   */
  it('reads no operational table in the benchmark service', () => {
    const source = readCode(join(__dirname, 'benchmark.service.ts'));

    expect(source).toContain('leadflow_product_telemetry_daily');

    for (const table of [
      'social_ad_metrics_daily',
      'social_ad_entities',
      'social_ad_destination_observations',
      'leadflow_client_settings',
      'leadflow_telemetry_consents',
      'leadflow_telemetry_identity_links',
    ]) {
      expect(source).not.toContain(table);
    }
  });

  /**
   * Nothing in the benchmark writes.
   *
   * A read model that could mutate would be able to repair its own sample,
   * which is the one thing that must never happen to a k-anonymity threshold.
   */
  it('issues no write from the benchmark service', () => {
    const source = readCode(join(__dirname, 'benchmark.service.ts'));

    // Matched as SQL keywords rather than as substrings. Upper-casing the whole
    // file and searching for "DELETE" also matches the word "deleted" in a
    // sentence — the assertion has to be about statements, not about prose,
    // otherwise it fails on documentation and gets weakened to make it pass.
    for (const statement of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
    ]) {
      expect(source).not.toMatch(statement);
    }
  });

  /**
   * The contribution builder is a builder, not a writer.
   *
   * It returns rows for the consent-owning service to persist. Writing directly
   * would put a fact-writing path outside the module that enforces consent.
   */
  it('does not persist from the contribution builder', () => {
    const source = readCode(
      join(__dirname, 'paid-media-contribution.service.ts'),
    );

    for (const statement of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\bDELETE\s+FROM\b/i,
    ]) {
      expect(source).not.toMatch(statement);
    }
  });

  /**
   * No FX, anywhere.
   *
   * Currency conversion would silently merge cohorts the decisions require to
   * stay separate, and it would do so with a rate nobody recorded.
   */
  it('performs no currency conversion', () => {
    for (const file of BENCHMARK_FILES) {
      const source = readCode(join(__dirname, file));

      for (const forbidden of ['exchangeRate', 'fxRate', 'convertCurrency']) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
