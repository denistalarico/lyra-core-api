// src/common/context/managed-visibility.policy.ts
//
// Policy matrix separating *aggregate* visibility from *operational*
// visibility (LF-RF-F12-002, Portal blueprint section 22).
//
// A person linked to several managed companies may legitimately see some
// things consolidated across all of them (projects, finance) and must never
// see others that way (LeadFlow, Social, product settings). The distinction
// is not cosmetic: an aggregate read crosses managed tenants by design, so
// every domain that allows it has to say so explicitly, in one place, with
// its canonical data source named.
//
// This module is the declaration. Enforcement stays where it already is —
// `PermissionsGuard` plus `OperationalContextResolver`, which refuse a
// LeadFlow request that carries no active company. The contract tests assert
// the two never drift apart.

import { ForbiddenException } from '@nestjs/common';

export type VisibilityScope =
  /** One resolved managed company. The only scope operational data accepts. */
  | 'active_company'
  /** Every company the caller is authorized for, consolidated. */
  | 'aggregate';

export type VisibilityProductKey = 'agency' | 'leadflow' | 'social';

export interface VisibilityDomainPolicy {
  /** Stable key used by tests, docs and future Portal routing. */
  key: string;
  productKey: VisibilityProductKey;
  /** Scopes this domain may legitimately be read in. */
  allowedScopes: VisibilityScope[];
  /**
   * API route prefixes governed by this domain, as mounted today. Kept next
   * to the policy so a new controller cannot silently escape the matrix.
   */
  routePrefixes: string[];
  /** Canonical source of truth for the data — no second copy is authoritative. */
  authority: string;
  /** Why the domain sits on this side of the line. */
  rationale: string;
}

const AGGREGATE_AND_ACTIVE: VisibilityScope[] = ['aggregate', 'active_company'];
const ACTIVE_ONLY: VisibilityScope[] = ['active_company'];

/**
 * Aggregate-capable domains. Consolidation is a product requirement here:
 * a client with three companies wants one project list and one financial
 * section, not three logins (blueprint sections 8.2 and 8.3).
 */
const AGGREGATE_DOMAINS: VisibilityDomainPolicy[] = [
  {
    key: 'agency.projects',
    productKey: 'agency',
    allowedScopes: AGGREGATE_AND_ACTIVE,
    routePrefixes: ['agency/projects'],
    authority: 'agency_projects / agency_tasks, scoped by client id',
    rationale:
      'Projects belong to the agency tenant and reference a client; ' +
      'consolidating the projects of the companies a person is authorized ' +
      'for does not cross into another tenant’s operation.',
  },
  {
    key: 'agency.finance',
    productKey: 'agency',
    allowedScopes: AGGREGATE_AND_ACTIVE,
    routePrefixes: ['agency/finance'],
    authority:
      'confirmed invoices and payments of the agency, filtered by client id',
    rationale:
      'The Portal shows one financial section per person. Only documents ' +
      'addressed to the companies they are authorized for are readable; ' +
      'internal cost, margin and profitability never enter this scope.',
  },
  {
    key: 'agency.dashboard_summary',
    productKey: 'agency',
    allowedScopes: AGGREGATE_AND_ACTIVE,
    routePrefixes: ['agency/dashboards'],
    authority: 'aggregations over the domains above',
    rationale:
      'A summary view may consolidate what its underlying domains already ' +
      'allow — and nothing else. It may not surface an operational metric ' +
      'that its own domain refuses to aggregate.',
  },
];

/**
 * Operational domains. These carry per-company configuration, conversations,
 * pipelines, agents and automations: an aggregate read would mix the data of
 * distinct managed tenants, which is the exact leak this phase exists to
 * prevent. "All companies" is never a valid context for them.
 */
const OPERATIONAL_DOMAINS: VisibilityDomainPolicy[] = [
  {
    key: 'leadflow.settings',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: [
      'leadflow/clients',
      'leadflow/agency/settings',
      'leadflow/business-modes',
      'leadflow/briefing',
      'leadflow/privacy/telemetry',
      // SMTP smoke test, gated by leadflow.settings.integrations.manage.admin.
      'email',
    ],
    authority: 'leadflow_client_settings, one row per company',
    rationale:
      'Business mode, apps, integrations, prompts and company context are ' +
      'per company by definition.',
  },
  {
    key: 'leadflow.inbox',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: ['inbox', 'webchat'],
    authority: 'inbox_conversations / inbox_channels, scoped by client id',
    rationale:
      'Conversations belong to one company’s channels. A consolidated inbox ' +
      'would expose one client’s contacts to another.',
  },
  {
    key: 'leadflow.crm',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: ['crm'],
    authority: 'crm_opportunities / crm_pipelines, scoped by client id',
    rationale:
      'Pipelines, stages and lead scores are configured per company and are ' +
      'not comparable across companies.',
  },
  {
    key: 'leadflow.agents',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: ['leadflow/agents'],
    authority: 'leadflow agent configuration of the active company',
    rationale:
      'Agent instructions and prompts are company assets and internal ' +
      'agency work at the same time; they never aggregate.',
  },
  {
    key: 'leadflow.automations',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: ['leadflow/automations', 'leadflow/events'],
    authority: 'leadflow_automations and the event contract',
    rationale:
      'An automation acts on one company’s data; an aggregate view would ' +
      'imply cross-company execution, which no runtime supports.',
  },
  {
    key: 'leadflow.analytics',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: ['leadflow/analytics'],
    authority: 'operational metrics of the active company',
    rationale:
      'Consolidating operational metrics across managed tenants would ' +
      'disclose the volume and performance of one client to another.',
  },
  {
    key: 'leadflow.agenda',
    productKey: 'leadflow',
    allowedScopes: ACTIVE_ONLY,
    routePrefixes: ['leadflow/agenda', 'appointments'],
    authority: 'scheduled_items and agency_activities (ADR-021)',
    rationale:
      'The LeadFlow agenda is a commercial view of one company’s ' +
      'appointments and activities.',
  },
];

export const MANAGED_VISIBILITY_DOMAINS: VisibilityDomainPolicy[] = [
  ...AGGREGATE_DOMAINS,
  ...OPERATIONAL_DOMAINS,
];

export const MANAGED_VISIBILITY_MATRIX: Record<string, VisibilityDomainPolicy> =
  Object.fromEntries(
    MANAGED_VISIBILITY_DOMAINS.map((domain) => [domain.key, domain]),
  );

export function getVisibilityDomain(
  domainKey: string,
): VisibilityDomainPolicy | null {
  return MANAGED_VISIBILITY_MATRIX[domainKey] ?? null;
}

/**
 * Resolves the domain that governs an API route prefix. Longest prefix wins,
 * so `leadflow/agenda/v1` resolves to the agenda domain rather than to a
 * shorter, more permissive one.
 */
export function resolveVisibilityDomainForRoute(
  routePath: string,
): VisibilityDomainPolicy | null {
  const normalized = routePath.replace(/^\/+/, '').replace(/\/+$/, '');

  let match: { domain: VisibilityDomainPolicy; length: number } | null = null;

  for (const domain of MANAGED_VISIBILITY_DOMAINS) {
    for (const prefix of domain.routePrefixes) {
      const isMatch =
        normalized === prefix || normalized.startsWith(`${prefix}/`);

      if (isMatch && (!match || prefix.length > match.length)) {
        match = { domain, length: prefix.length };
      }
    }
  }

  return match?.domain ?? null;
}

export function isVisibilityScopeAllowed(
  domainKey: string,
  scope: VisibilityScope,
): boolean {
  // Deny by default: an unregistered domain is not "allowed everywhere",
  // it is a domain nobody has classified yet.
  return getVisibilityDomain(domainKey)?.allowedScopes.includes(scope) ?? false;
}

export function assertVisibilityScopeAllowed(
  domainKey: string,
  scope: VisibilityScope,
): void {
  if (!isVisibilityScopeAllowed(domainKey, scope)) {
    throw new ForbiddenException(
      `Scope "${scope}" is not allowed for domain "${domainKey}".`,
    );
  }
}

/** Domains that must always run inside one resolved company. */
export function listOperationalDomains(): VisibilityDomainPolicy[] {
  return MANAGED_VISIBILITY_DOMAINS.filter(
    (domain) => !domain.allowedScopes.includes('aggregate'),
  );
}

/** Domains a consolidated Portal view may read across companies. */
export function listAggregateDomains(): VisibilityDomainPolicy[] {
  return MANAGED_VISIBILITY_DOMAINS.filter((domain) =>
    domain.allowedScopes.includes('aggregate'),
  );
}
