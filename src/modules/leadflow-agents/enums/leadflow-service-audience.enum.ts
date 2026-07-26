import type { LeadFlowAgentBehaviorConfig } from '../types/leadflow-agent.types';

/**
 * Who an agent is allowed to serve — the commercial audience, distinct from the
 * agent's TYPE (reception/qualifier/sales/…) and from the Business Mode.
 *
 *   leads               → only prospects still in acquisition/conversion
 *   customers           → only already-converted customers of the company
 *   leads_and_customers → both
 *
 * Regardless of the value, an internal user (a member of the operation) is NEVER
 * served by an external agent — that is enforced by the contact-relationship
 * rule, not by widening this enum.
 */
export enum LeadFlowServiceAudience {
  Leads = 'leads',
  Customers = 'customers',
  LeadsAndCustomers = 'leads_and_customers',
}

/**
 * Conservative default: an agent with no explicit choice serves both leads and
 * customers, preserving today's behaviour (no audience filtering).
 */
export const DEFAULT_SERVICE_AUDIENCE = LeadFlowServiceAudience.LeadsAndCustomers;

const SERVICE_AUDIENCE_VALUES = new Set<string>(
  Object.values(LeadFlowServiceAudience),
);

export function isServiceAudience(value: unknown): value is LeadFlowServiceAudience {
  return typeof value === 'string' && SERVICE_AUDIENCE_VALUES.has(value);
}

/**
 * The agent's audience, read from its behaviour config with a safe default. A
 * stable technical field (`serviceAudience`) that lives in the existing
 * `behavior_config` jsonb — no migration, and settable through the same
 * pass-through DTO as the rest of the behaviour config.
 */
export function resolveServiceAudience(
  behaviorConfig: LeadFlowAgentBehaviorConfig | null | undefined,
): LeadFlowServiceAudience {
  const value = behaviorConfig?.serviceAudience;
  return isServiceAudience(value) ? value : DEFAULT_SERVICE_AUDIENCE;
}
