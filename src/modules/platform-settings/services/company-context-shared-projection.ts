// src/modules/platform-settings/services/company-context-shared-projection.ts
//
// The shared/LeadFlow-only boundary *inside* `leadflow_client_settings`'s
// company context (Lyra Social S1.4.0 review). `CompanyContextService`
// already enforces the outer schema (root keys, guards, hashing); this file
// only picks which of those roots/subfields a non-LeadFlow caller may read
// or write. See docs/architecture/social/social-settings-architecture.md §1
// and §3.A — `qualification.*` and `service.{handoffRules,serviceLevel,
// emergencyRules,unsupportedRequests}` are LeadFlow-only; everything else
// under `identity` (except `legalName`), plus `contact`, `offers`, `service.
// businessHours`, `policies`, `faq` and `links`, is shared.

import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';

/** `identity` fields a non-LeadFlow caller may read/write. `legalName` is LeadFlow-only. */
const SHARED_IDENTITY_FIELDS = [
  'publicName',
  'summary',
  'valueProposition',
  'differentiators',
  'targetAudience',
  'languages',
  'timezone',
  'regionsServed',
] as const;

/** `service` fields a non-LeadFlow caller may read/write. Everything else under
 * `service` (handoffRules, serviceLevel, emergencyRules, unsupportedRequests)
 * is LeadFlow-only conversational/SLA configuration. */
const SHARED_SERVICE_FIELDS = ['businessHours'] as const;

/** Whole roots a non-LeadFlow caller may read/write as-is. `qualification` and
 * `legacyTone` are deliberately absent: `qualification` is LeadFlow-only by
 * definition, and `legacyTone` has no shared classification in the
 * architecture docs. */
const SHARED_LIST_OR_SCALAR_ROOTS = [
  'offers',
  'policies',
  'faq',
  'links',
] as const;

function isPlainObject(value: unknown): value is LeadFlowJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickFields(
  source: LeadFlowJsonObject,
  fields: readonly string[],
): LeadFlowJsonObject {
  const picked: LeadFlowJsonObject = {};
  for (const field of fields) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

function mergeSharedObject(
  existing: LeadFlowJsonObject,
  incoming: LeadFlowJsonObject,
): LeadFlowJsonObject {
  const merged: LeadFlowJsonObject = { ...existing };

  for (const [field, value] of Object.entries(incoming)) {
    const existingValue = existing[field];
    if (isPlainObject(value) && isPlainObject(existingValue)) {
      merged[field] = mergeSharedObject(existingValue, value);
    } else {
      merged[field] = value;
    }
  }

  return merged;
}

/**
 * Projects a full company context document down to the fields a non-LeadFlow
 * caller may see. Used for both `companyContextDraft` and
 * `companyContextPublished` — same shared boundary applies to both.
 */
export function pickSharedCompanyContext(
  source: LeadFlowJsonObject,
): LeadFlowJsonObject {
  const projected: LeadFlowJsonObject = {};

  if (isPlainObject(source.identity)) {
    projected.identity = pickFields(source.identity, SHARED_IDENTITY_FIELDS);
  }

  if (isPlainObject(source.service)) {
    projected.service = pickFields(source.service, SHARED_SERVICE_FIELDS);
  }

  if (source.contact !== undefined) projected.contact = source.contact;

  for (const root of SHARED_LIST_OR_SCALAR_ROOTS) {
    if (source[root] !== undefined) projected[root] = source[root];
  }

  return projected;
}

/**
 * Merges a caller-supplied shared-fields-only document onto the full
 * existing draft, preserving every LeadFlow-only subtree
 * (`qualification.*`, `service.handoffRules`/`serviceLevel`/
 * `emergencyRules`/`unsupportedRequests`, `identity.legalName`, `legacyTone`)
 * untouched. This is the merge that keeps `PATCH /platform/business-profile`
 * from being a blind replace of the whole JSONB document — the shape
 * `LeadFlowClientSettingsService.applySettingsUpdate` writes with
 * `companyContextDraft = normalize(dto.companyContextDraft)` is a full
 * replace, so the caller of that method (this module) must hand it a
 * complete document, never a partial one.
 *
 * Only fields present in `incomingSharedFields` are applied — a field
 * omitted from the PATCH body leaves the existing shared value untouched,
 * matching PATCH semantics elsewhere in this service (see
 * `UpdateLeadFlowClientSettingsDto`, where every field is optional).
 */
export function mergeSharedCompanyContext(
  existing: LeadFlowJsonObject,
  incomingSharedFields: LeadFlowJsonObject,
): LeadFlowJsonObject {
  const merged: LeadFlowJsonObject = { ...existing };

  if (incomingSharedFields.identity !== undefined) {
    if (!isPlainObject(incomingSharedFields.identity)) {
      merged.identity = incomingSharedFields.identity;
    } else {
      const existingIdentity = isPlainObject(existing.identity)
        ? existing.identity
        : {};
      merged.identity = {
        ...existingIdentity,
        ...pickFields(incomingSharedFields.identity, SHARED_IDENTITY_FIELDS),
      };
    }
  }

  if (incomingSharedFields.service !== undefined) {
    if (!isPlainObject(incomingSharedFields.service)) {
      merged.service = incomingSharedFields.service;
    } else {
      const existingService = isPlainObject(existing.service)
        ? existing.service
        : {};
      merged.service = {
        ...existingService,
        ...pickFields(incomingSharedFields.service, SHARED_SERVICE_FIELDS),
      };
    }
  }

  if (incomingSharedFields.contact !== undefined) {
    if (!isPlainObject(incomingSharedFields.contact)) {
      merged.contact = incomingSharedFields.contact;
    } else {
      const existingContact = isPlainObject(existing.contact)
        ? existing.contact
        : {};
      merged.contact = mergeSharedObject(
        existingContact,
        incomingSharedFields.contact,
      );
    }
  }

  for (const root of SHARED_LIST_OR_SCALAR_ROOTS) {
    if (incomingSharedFields[root] !== undefined) {
      merged[root] = incomingSharedFields[root];
    }
  }

  return merged;
}

/**
 * The document a Platform-surface publish writes to
 * `companyContextPublished` (S1.4.3d).
 *
 * `LeadFlowClientSettingsService.publishCompanyContext` publishes the *full*
 * stored draft by default, LeadFlow-only subtrees included. That is correct
 * for `/leadflow/*`, which shows the operator the whole document. It is not
 * safe for `/platform/business-profile`, which only ever showed the operator
 * the shared projection: a LeadFlow-only edit sitting unpublished on the
 * draft would be shipped to the shared consumers without anyone on the
 * Platform side ever having reviewed it.
 *
 * So the Platform path publishes only its own surface, by overlaying the
 * shared projection of the draft onto a base that supplies every domain
 * Platform does not control:
 *
 *   - `base` = the current full published document, when one exists. Hidden
 *     subtrees stay exactly as they were last published; a pending hidden
 *     draft edit is simply not promoted (and stays in the draft, for LeadFlow
 *     to publish later).
 *   - `base` = the current Business Mode's canonical context defaults, on a
 *     first publish. There is no baseline to carry over and — per S1.4.3c —
 *     no trustworthy way to reconstruct one, so the domains Platform does not
 *     control take the defaults the mode ships today. This is an explicit
 *     semantic, not a reconstruction of history.
 *
 * Both cases reuse `pickSharedCompanyContext`/`mergeSharedCompanyContext` —
 * the same boundary the read and write paths already enforce — so there is no
 * second, divergence-prone notion of which fields are shared.
 *
 * Callers are expected to hand in documents already normalized by
 * `CompanyContextService.normalizePersisted`; the publish path normalizes the
 * result again before hashing and persisting it.
 */
export function buildSharedSurfacePublishDocument(
  normalizedFullDraft: LeadFlowJsonObject,
  normalizedBase: LeadFlowJsonObject,
): LeadFlowJsonObject {
  return mergeSharedCompanyContext(
    normalizedBase,
    pickSharedCompanyContext(normalizedFullDraft),
  );
}
