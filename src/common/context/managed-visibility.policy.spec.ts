import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import {
  assertVisibilityScopeAllowed,
  isVisibilityScopeAllowed,
  listAggregateDomains,
  listOperationalDomains,
  MANAGED_VISIBILITY_DOMAINS,
  resolveVisibilityDomainForRoute,
} from './managed-visibility.policy';

const MODULES_ROOT = join(__dirname, '..', '..', 'modules');

function listControllerFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);

    if (statSync(fullPath).isDirectory()) {
      files.push(...listControllerFiles(fullPath));
      continue;
    }

    if (entry.endsWith('.controller.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Every controller that declares the LeadFlow entitlement, with the route
 * prefix it is mounted on. Read from source so a new controller joins this
 * matrix automatically instead of quietly escaping it.
 */
function listLeadFlowControllerRoutes(): { file: string; route: string }[] {
  return listControllerFiles(MODULES_ROOT)
    .map((file) => {
      const source = readFileSync(file, 'utf8');

      if (!/@RequireProductEntitlement\(\s*'leadflow'\s*\)/.test(source)) {
        return null;
      }

      const route = /@Controller\(\s*'([^']*)'\s*\)/.exec(source)?.[1];

      return route === undefined ? null : { file, route };
    })
    .filter((entry): entry is { file: string; route: string } => entry !== null);
}

describe('managed visibility policy (LF-RF-F12-002)', () => {
  it('classifies every registered domain on exactly one side of the line', () => {
    const aggregate = listAggregateDomains().map((domain) => domain.key);
    const operational = listOperationalDomains().map((domain) => domain.key);

    expect(aggregate.length + operational.length).toBe(
      MANAGED_VISIBILITY_DOMAINS.length,
    );
    expect(aggregate.filter((key) => operational.includes(key))).toEqual([]);
  });

  it('never lets a LeadFlow or Social domain be read across companies', () => {
    const productScoped = MANAGED_VISIBILITY_DOMAINS.filter(
      (domain) => domain.productKey !== 'agency',
    );

    expect(productScoped.length).toBeGreaterThan(0);

    for (const domain of productScoped) {
      expect(domain.allowedScopes).toEqual(['active_company']);
      expect(isVisibilityScopeAllowed(domain.key, 'aggregate')).toBe(false);
    }
  });

  it('allows projects, finance and the summary dashboard to consolidate', () => {
    for (const domainKey of [
      'agency.projects',
      'agency.finance',
      'agency.dashboard_summary',
    ]) {
      expect(isVisibilityScopeAllowed(domainKey, 'aggregate')).toBe(true);
      expect(isVisibilityScopeAllowed(domainKey, 'active_company')).toBe(true);
    }
  });

  it('names a canonical authority for every domain', () => {
    for (const domain of MANAGED_VISIBILITY_DOMAINS) {
      expect(domain.authority.trim().length).toBeGreaterThan(0);
      expect(domain.rationale.trim().length).toBeGreaterThan(0);
      expect(domain.routePrefixes.length).toBeGreaterThan(0);
    }
  });

  it('denies unknown domains instead of defaulting to permissive', () => {
    expect(isVisibilityScopeAllowed('portal.something_new', 'aggregate')).toBe(
      false,
    );
    expect(
      isVisibilityScopeAllowed('portal.something_new', 'active_company'),
    ).toBe(false);
    expect(() =>
      assertVisibilityScopeAllowed('portal.something_new', 'active_company'),
    ).toThrow(ForbiddenException);
  });

  it('throws when an operational domain is asked for an aggregate read', () => {
    expect(() =>
      assertVisibilityScopeAllowed('leadflow.inbox', 'aggregate'),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertVisibilityScopeAllowed('leadflow.inbox', 'active_company'),
    ).not.toThrow();
  });

  describe('route resolution', () => {
    it('resolves real LeadFlow routes to operational-only domains', () => {
      const cases: [string, string][] = [
        ['inbox/conversations', 'leadflow.inbox'],
        ['inbox/channels/whatsapp/health', 'leadflow.inbox'],
        ['crm/opportunities', 'leadflow.crm'],
        ['leadflow/agents/instances', 'leadflow.agents'],
        ['leadflow/automations/recipes', 'leadflow.automations'],
        ['leadflow/analytics/views', 'leadflow.analytics'],
        ['leadflow/agenda/v1/items', 'leadflow.agenda'],
        ['leadflow/clients/capacity', 'leadflow.settings'],
      ];

      for (const [route, expectedDomain] of cases) {
        const domain = resolveVisibilityDomainForRoute(route);

        expect(domain?.key).toBe(expectedDomain);
        expect(domain?.allowedScopes).toEqual(['active_company']);
      }
    });

    it('resolves aggregate-capable routes to aggregate domains', () => {
      expect(resolveVisibilityDomainForRoute('agency/projects/123')?.key).toBe(
        'agency.projects',
      );
      expect(resolveVisibilityDomainForRoute('/agency/finance/bills')?.key).toBe(
        'agency.finance',
      );
    });

    it('does not match a prefix that is only a string prefix of a route', () => {
      expect(resolveVisibilityDomainForRoute('crmx/opportunities')).toBeNull();
      expect(resolveVisibilityDomainForRoute('unknown/route')).toBeNull();
    });
  });

  it('covers every controller that declares the LeadFlow entitlement', () => {
    const routes = listLeadFlowControllerRoutes();

    // Guards the scan itself: if the regex stops matching, the assertion
    // below would pass vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(15);

    const uncovered = routes.filter(({ route }) => {
      const domain = resolveVisibilityDomainForRoute(route);

      return !domain || domain.allowedScopes.includes('aggregate');
    });

    expect(uncovered).toEqual([]);
  });
});
