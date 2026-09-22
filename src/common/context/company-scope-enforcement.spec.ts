import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from './request-context.interface';
import { resolveCompanyAwareScope } from './company-aware-scope';
import { resolveInboxCompanyScope } from '../../modules/inbox/inbox-company-scope';
import { creativeStudioScope } from '../../modules/social-creative-studio/creative-studio.scope';

const MODULES = join(__dirname, '..', '..', 'modules');

function legacyClientContext(): RequestContext {
  return {
    tenantId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000001',
    userId: '30000000-0000-4000-8000-000000000001',
    role: 'owner',
    managedContext: {
      productKey: 'social',
      operatingMode: 'client',
      // The legacy selection CC2G must refuse: a client with no company.
      clientId: '40000000-0000-4000-8000-000000000001',
      companyContextId: null,
      managedTenantId: '60000000-0000-4000-8000-000000000001',
    },
  } as RequestContext;
}

function sourceOf(relativePath: string): string {
  return readFileSync(join(MODULES, relativePath), 'utf8');
}

/**
 * CC2G — enforcement across the boundaries migrated in CC2C–CC2F.
 *
 * Rather than booting each service, these tests assert the two facts that
 * together make client-wide leakage impossible:
 *
 * 1. the shared resolvers refuse a client-mode request with no company; and
 * 2. each boundary's scope actually comes from one of those resolvers.
 */
describe('CC2G enforcement — shared resolvers fail closed', () => {
  it.each([
    ['resolveCompanyAwareScope', resolveCompanyAwareScope],
    ['resolveInboxCompanyScope', resolveInboxCompanyScope],
    ['creativeStudioScope', creativeStudioScope],
  ])('%s refuses client mode without a company', (_name, resolve) => {
    expect(() => resolve(legacyClientContext())).toThrow(BadRequestException);
  });

  it('leaves agency mode untouched — it has no company to select', () => {
    const agencyContext = {
      ...legacyClientContext(),
      managedContext: {
        productKey: 'social',
        operatingMode: 'agency',
        clientId: null,
        companyContextId: null,
        managedTenantId: null,
      },
    } as RequestContext;

    expect(() => resolveCompanyAwareScope(agencyContext)).not.toThrow();
  });
});

/**
 * One representative root per migrated boundary, as CC2G requires. Each entry
 * names the file that owns the boundary's scope and the resolver it must use.
 */
const BOUNDARIES: Array<[string, string, string]> = [
  // Social
  ['Social Planner', 'social-planner/social-planner.controller.ts', 'resolveCompanyAwareScope'],
  ['Brand Kit', 'brand-kit/services/brand-kit.service.ts', 'resolveCompanyAwareScope'],
  ['Creative Studio', 'social-creative-studio/creative-studio.scope.ts', 'resolveCompanyAwareScope'],
  ['Social Organic / Publishing', 'social-organic/publication/social-publication.controller.ts', 'resolveCompanyAwareScope'],
  ['Social Ads', 'social-integrations/social-integrations.controller.ts', 'resolveCompanyAwareScope'],
  // LeadFlow
  ['LeadFlow Settings', 'leadflow-settings/services/leadflow-client-settings.service.ts', 'resolveCompanyAwareScope'],
  ['Inbox / Conversation', 'inbox/inbox-company-scope.ts', 'resolveCompanyAwareScope'],
  ['CRM', 'crm/crm.service.ts', 'resolveCompanyAwareScope'],
  ['Agents', 'leadflow-agents/services/leadflow-agent.service.ts', 'resolveCompanyAwareScope'],
  ['Automations', 'leadflow-automations/services/leadflow-automation.service.ts', 'resolveCompanyAwareScope'],
  ['Scheduled Items', 'appointments/appointments.service.ts', 'resolveCompanyAwareScope'],
  // LeadFlow Analytics (CC2G.1)
  ['Operational Analytics', 'leadflow-analytics/services/leadflow-operational-analytics.service.ts', 'resolveCompanyAwareScope'],
  ['Overview', 'leadflow-analytics/services/leadflow-overview.service.ts', 'resolveCompanyAwareScope'],
  ['Commercial Journey', 'leadflow-analytics/services/leadflow-analytics.service.ts', 'resolveCompanyAwareScope'],
];

describe('CC2G enforcement — every migrated boundary resolves through the shared scope', () => {
  it.each(BOUNDARIES)('%s', (_label, file, resolver) => {
    expect(sourceOf(file)).toContain(resolver);
  });
});

describe('CC2G enforcement — removed client-wide fallbacks', () => {
  it('CRM no longer filters roots by the company-blind metadata clientId', () => {
    const source = sourceOf('crm/crm.service.ts');
    // The helper is gone; only the historical note in a comment may mention it.
    expect(source).not.toContain('this.withClientScope');
    expect(source).not.toContain('private withClientScope');
    expect(source).toContain('withCompanyScope');
  });

  it.each([
    ['operational analytics', 'leadflow-analytics/services/leadflow-operational-analytics.service.ts'],
    ['overview', 'leadflow-analytics/services/leadflow-overview.service.ts'],
    ['commercial journey analytics', 'leadflow-analytics/services/leadflow-analytics.service.ts'],
  ])(
    /**
     * CC2G.1 superseded CC2G's fail-closed stopgap here: these three read
     * models now resolve the real persisted scope through
     * `resolveCompanyAwareScope` (still refusing client mode without a
     * company) and scope every query by `company_context_id`, instead of
     * refusing every client-mode request outright via the now-removed
     * `assertCompanyContextForAnalytics`.
     */
    'LeadFlow %s resolves through the shared company-aware scope',
    (_label, file) => {
      expect(sourceOf(file)).toContain('resolveCompanyAwareScope');
      expect(sourceOf(file)).not.toContain('assertCompanyContextForAnalytics');
    },
  );
});
