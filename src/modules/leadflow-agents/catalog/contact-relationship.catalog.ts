import { LeadFlowServiceAudience } from '../enums/leadflow-service-audience.enum';

/**
 * The canonical relationship a contact has with the company. One auditable
 * vocabulary shared by acquisition (leads), post-conversion (customers) and the
 * operation itself (internal users), plus an explicit `unknown` for when no
 * canonical source has classified the contact yet.
 *
 *   lead          → a prospect still in acquisition/conversion
 *   customer      → an already-converted customer of the company
 *   internal_user → a member of the operation (never served by external agents)
 *   unknown       → not yet classifiable from canonical sources
 *
 * Deliberately NOT inferred from the mere existence of an opportunity: a contact
 * becomes a `customer` only from a canonical conversion signal (a linked client
 * / signed contract / won-and-onboarded flag), never because a deal exists.
 */
export enum ContactRelationship {
  Lead = 'lead',
  Customer = 'customer',
  InternalUser = 'internal_user',
  Unknown = 'unknown',
}

/**
 * Canonical, auditable signals a relationship is resolved from. Each is expected
 * to come from its owning domain's source of truth — never a guess:
 *  - `isInternalUser`: the contact matches a workspace user (the existing gate).
 *  - `isCustomer`: a canonical conversion exists (linked client / contract), NOT
 *    an opportunity.
 *  - `isLead`: an active prospect (in a pipeline / qualified).
 */
export interface ContactRelationshipSignals {
  isInternalUser: boolean;
  isCustomer: boolean;
  isLead: boolean;
}

/**
 * Resolves the canonical relationship from its signals, most-authoritative
 * first: internal always wins (safety), then a proven customer, then an active
 * lead, else unknown.
 */
export function resolveContactRelationship(
  signals: ContactRelationshipSignals,
): ContactRelationship {
  if (signals.isInternalUser) {
    return ContactRelationship.InternalUser;
  }
  if (signals.isCustomer) {
    return ContactRelationship.Customer;
  }
  if (signals.isLead) {
    return ContactRelationship.Lead;
  }
  return ContactRelationship.Unknown;
}

/**
 * Whether an agent with the given audience may serve a contact of the given
 * relationship.
 *
 * Two invariants:
 *  - An internal user is NEVER served, whatever the audience (Adendo item 8).
 *  - `unknown` never blocks: audience filtering only ever refuses a *definite*
 *    opposite relationship, so an unclassified inbound is still handled as today.
 */
export function audienceServesRelationship(
  audience: LeadFlowServiceAudience,
  relationship: ContactRelationship,
): boolean {
  if (relationship === ContactRelationship.InternalUser) {
    return false;
  }
  if (relationship === ContactRelationship.Unknown) {
    return true;
  }
  switch (audience) {
    case LeadFlowServiceAudience.Leads:
      return relationship === ContactRelationship.Lead;
    case LeadFlowServiceAudience.Customers:
      return relationship === ContactRelationship.Customer;
    case LeadFlowServiceAudience.LeadsAndCustomers:
      return (
        relationship === ContactRelationship.Lead ||
        relationship === ContactRelationship.Customer
      );
    default:
      return false;
  }
}
