import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Guards the property that makes this a *shared* contract rather than one
 * domain's types borrowed by another.
 *
 * The contract lives in `common/` because both `social-integrations` and
 * `leadflow-analytics` depend on it. The moment it imports either of them, that
 * inverts: the folder becomes a domain module with a misleading address, and the
 * two products acquire a transitive dependency on each other through it — which
 * is precisely the coupling the whole design exists to avoid.
 *
 * The failure mode is ordinary rather than malicious. Somebody adds a metric,
 * wants the `SocialAdMetricDailyEntity` type for a field, imports it because it
 * is right there, and the boundary is gone with nothing visible in review.
 *
 * The same reasoning covers NestJS and TypeORM. A `@Injectable` here would make
 * the contract a provider that a module has to register; a `Repository` would
 * make it aware of storage. It is types and pure functions, and staying that way
 * is what lets a scheduled job, an HTTP surface and eventually the Client Area
 * all use it without dragging a module graph along.
 */
const CONTRACT_DIR = __dirname;

/**
 * Every `.ts` in the contract directory — **specs included**.
 *
 * The exclusion of specs was the hole this file originally shipped with. The
 * production sources were clean and the contract's own spec imported
 * `social-ad-kpi` from `modules/social-integrations` to assert ratio semantics,
 * so the very dependency this file exists to forbid was present in the
 * directory and invisible to the check that was supposed to see it.
 *
 * A spec is code, it is compiled by the same `tsconfig`, and a spec-only import
 * couples the two just as firmly for anyone extracting the folder later. Those
 * assertions moved to `social-paid-media-intelligence.adapter.spec`, where
 * Social may depend on the contract and reach its own KPI module.
 */
const CONTRACT_SOURCES = readdirSync(CONTRACT_DIR).filter((file) =>
  file.endsWith('.ts'),
);

/** The production sources alone, for the rules that only bind them. */
const CONTRACT_IMPLEMENTATION = CONTRACT_SOURCES.filter(
  (file) => !file.endsWith('.spec.ts'),
);

/**
 * This file, excluded from the rules that search for forbidden *names*.
 *
 * It is the one file in the directory that must spell `social-integrations` and
 * `RequestContext` out — that is what it is for. The import rules still apply to
 * it, which is the part that actually constrains it: naming a domain in a string
 * literal couples nothing, importing one does.
 */
const SELF = 'intelligence-contract.boundary.spec.ts';

const NAME_CHECKED = CONTRACT_SOURCES.filter((file) => file !== SELF);

/**
 * Import paths the contract may not name.
 *
 * `../../modules` catches every domain module at once, which is stronger than
 * listing the two that exist today: the next domain to grow an adapter is
 * covered without anyone remembering to add it here.
 */
const FORBIDDEN_IMPORTS = [
  '../../modules',
  '@nestjs',
  'typeorm',
  '../context/request-context',
];

/** The file's code, with comments removed. */
function readCode(file: string): string {
  return readFileSync(join(CONTRACT_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function readImports(file: string): string[] {
  const source = readFileSync(join(CONTRACT_DIR, file), 'utf8');

  return [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
}

describe('shared intelligence contract boundary', () => {
  it('has sources to check', () => {
    // A guard on the guard: a rename that emptied this list would make every
    // assertion below pass vacuously.
    expect(CONTRACT_SOURCES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(CONTRACT_SOURCES)('%s imports no domain module', (file) => {
    for (const specifier of readImports(file)) {
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(specifier.startsWith(forbidden)).toBe(false);
      }

      // Depth-independent: `../../modules` is the path from this directory, but
      // a file one level deeper would reach the same place through
      // `../../../modules` and slip past a prefix check.
      expect(specifier).not.toMatch(/(^|\/)modules\//);
    }
  });

  /**
   * Named explicitly rather than left to the generic rule above.
   *
   * These two are the domains that exist today, and a failure here says which
   * boundary broke instead of only that some path started with `modules/`.
   */
  it.each(NAME_CHECKED)('%s names neither adapter domain', (file) => {
    const source = readCode(file);

    for (const domain of [
      'social-integrations',
      'leadflow-analytics',
      'social-ad-kpi',
      'SocialAnalyticsReadService',
      'SocialPaidMediaIntelligenceAdapter',
      'LeadFlowIntelligenceAdapter',
      'deriveSocialAdKpis',
    ]) {
      expect(source).not.toContain(domain);
    }
  });

  /**
   * I5: the Business Mode dimension describes a value LeadFlow stores, and it
   * must remain a *description*.
   *
   * The specific failure this guards is subtle and would look like a
   * convenience. `BusinessModeDimension` has a `source` field naming a LeadFlow
   * table as a string, which couples nothing — but the next person needing a
   * label, an enum member or a default may reach for `LeadFlowBusinessMode` or
   * the settings entity, which are right there and would invert the whole
   * arrow: `common/intelligence` would depend on LeadFlow, and Social would
   * acquire a transitive dependency on it through the shared contract.
   *
   * The one legal spelling is `'leadflow_client_settings'` — the storage name
   * inside a string union — and the assertions below allow exactly that while
   * forbidding every type, service and enum that would make it real code. The
   * `leadflow-settings` path check is the one that actually binds: it is the
   * module the value lives in, and it is not covered by the domain list above,
   * which names only the two *analytics* modules.
   */
  it.each(NAME_CHECKED)('%s imports nothing from LeadFlow settings', (file) => {
    const source = readCode(file);

    for (const forbidden of [
      'leadflow-settings',
      'LeadFlowBusinessMode',
      'LeadFlowClientSettings',
      'BusinessModeDimensionAdapter',
      'BusinessModeDimensionPort',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  /**
   * The catalog is not duplicated here (§1, §20).
   *
   * `leadflow_business_mode_templates` is the single source of business-mode
   * keys and labels, and it is tenant-extensible: a tenant can add its own
   * template, so any list written into this file would be wrong for that tenant
   * from the moment it was typed. The dimension therefore carries whatever key
   * is stored and asks the catalog for the label — it never enumerates modes.
   *
   * Checked by the keys themselves rather than by a type name, because the way
   * a second catalog appears is somebody pasting the twelve strings in to give
   * `key` a narrower type than `string`.
   */
  it.each(NAME_CHECKED)('%s enumerates no business mode key', (file) => {
    const source = readCode(file);

    for (const key of [
      'agency_services',
      'clinics_esthetics',
      'real_estate',
      'restaurants_food',
      'ecommerce_light',
    ]) {
      expect(source).not.toContain(key);
    }
  });

  /**
   * Implementation only, and stricter than the rule above: a production source
   * may import from nowhere but this directory — not even a Node builtin, since
   * the contract is types and pure functions.
   *
   * Specs are exempt from *this* rule alone, because a boundary spec has to read
   * files to check them. Every other rule here still binds them, including the
   * one that matters: no `modules/` import at any depth.
   */
  it.each(CONTRACT_IMPLEMENTATION)(
    '%s imports only from within the contract',
    (file) => {
      for (const specifier of readImports(file)) {
        expect(specifier.startsWith('./')).toBe(true);
      }
    },
  );

  /** Specs may reach for `fs`/`path`, and for nothing that carries a domain. */
  it.each(CONTRACT_SOURCES.filter((file) => file.endsWith('.spec.ts')))(
    '%s imports only the contract and Node builtins',
    (file) => {
      for (const specifier of readImports(file)) {
        expect(
          specifier.startsWith('./') || ['fs', 'path'].includes(specifier),
        ).toBe(true);
      }
    },
  );

  /**
   * `RequestContext` is deliberately not the scope type — see
   * `IntelligenceScope`. It carries `userId`, `role` and `productKey`, none of
   * which a fact source should see, and it ties the port to an HTTP request it
   * must outlive.
   */
  it.each(NAME_CHECKED)('%s does not reach for RequestContext', (file) => {
    // Comments stripped, as in `social-analytics.boundary.spec`: these files
    // explain at length *why* the scope type is not `RequestContext`, and a
    // naive substring search would fail on the explanation of the rule it is
    // enforcing — with the obvious fix being to delete the reasoning.
    const source = readCode(file);

    expect(source).not.toContain('RequestContext');
    expect(source).not.toContain('managedContext');
  });

  // Implementation only: a spec may legitimately reach for test doubles that a
  // production source may not.
  it.each(CONTRACT_IMPLEMENTATION)('%s declares no NestJS provider', (file) => {
    const source = readCode(file);

    expect(source).not.toContain('@Injectable');
    expect(source).not.toContain('@Module');
  });
});
