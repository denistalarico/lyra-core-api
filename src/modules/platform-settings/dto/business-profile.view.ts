// src/modules/platform-settings/dto/business-profile.view.ts
//
// Sanitized read contract for `/platform/business-profile`
// (Lyra Social S1.4.0 — see docs/architecture/social/social-settings-*.md).
//
// This view is built by *construction*, never by deletion or spreading the
// LeadFlow response: a field is exposed only because it is written below.
// Anything LeadFlow-only added to `leadflow_client_settings` tomorrow — a new
// prompt, a new runtime flag — cannot leak here by accident. See
// social-settings-architecture.md §2 and §5 for the field list this mirrors.
//
// `companyContextDraft`/`companyContextPublished` are themselves not fully
// shared: `qualification.*` and `service.{handoffRules,serviceLevel,
// emergencyRules,unsupportedRequests}` are LeadFlow-only subtrees inside an
// otherwise-shared JSONB document (architecture.md §1, §3.A). Those are
// projected away by `pickSharedCompanyContext`, not merely omitted at the
// top level like the entity-level fields above.
//
// `companyContextDraftHash` (S1.4.3b) is the SHA-256 of the *full, persisted*
// draft — the same value `LeadFlowClientSettingsService.publishCompanyContext`
// computes internally and compares `expectedDraftHash` against. It is
// computed by the caller (`PlatformBusinessProfileService`) from the full
// `companyContextDraft` it already holds, via the same
// `CompanyContextService.hash(normalizePersisted(...))` pair the publish path
// uses — never a new hashing routine, and never derived from the *projected*
// (shared-only) document, which would produce a different hash than the one
// `publishCompanyContext` actually checks. `companyContextPublishedHash` is a
// distinct, pre-existing field: the hash of the last *published* document. A
// caller must never send it as `expectedDraftHash` — see
// social-settings-decisions.md D-2/D-3 addendum (S1.4.3b) and
// `SocialBrandKitSection.handlePublish`.
//
// Exposing the hash of a document the caller cannot fully read is safe: the
// hash is an opaque commitment value, not a summary of hidden content — see
// `hash` metadata note in social-settings-implementation-plan.md S1.4.3b §7.

import type { LeadFlowClientSettingsResponse } from '../../leadflow-settings/dto/leadflow-client-settings-response.dto';
import type { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';
import { pickSharedCompanyContext } from '../services/company-context-shared-projection';

export interface BusinessProfileResponse {
  businessModeKey: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
  companyContextDraft: LeadFlowJsonObject;
  companyContextPublished: LeadFlowJsonObject;
  companyContextSchemaVersion: number;
  companyContextDraftHash: string;
  companyContextPublishedVersion: number;
  companyContextPublishedHash: string | null;
  companyContextPublishedAt: Date | null;
}

/**
 * The only place allowed to turn a `LeadFlowClientSettingsResponse` into
 * what a non-LeadFlow caller may see. Never spread the source object here —
 * every field below is named explicitly so a boundary test can assert the
 * LeadFlow-only fields (agentConfig, inboxConfig, inboxOverrides,
 * handoffOverrides, leadsConfig, pipelineRef, businessModeOverrides,
 * developerOverrides, permissionsConfig, enabledApps, enabledIntegrations,
 * status) never appear in the payload — and `qualification.*` /
 * `service.{handoffRules,serviceLevel,emergencyRules,unsupportedRequests}`
 * never appear inside the company context fields either.
 *
 * `companyContextDraftHash` is passed in already computed by the caller
 * (from the *full*, unprojected draft) rather than recomputed here, so this
 * function stays a pure, dependency-free mapper — hashing needs
 * `CompanyContextService`, which belongs in the service layer.
 */
export function mapBusinessProfileResponse(
  source: LeadFlowClientSettingsResponse,
  companyContextDraftHash: string,
): BusinessProfileResponse {
  return {
    businessModeKey: source.businessModeKey,
    contextType: source.contextType,
    agencyClientId: source.agencyClientId,
    companyContextDraft: pickSharedCompanyContext(source.companyContextDraft),
    companyContextPublished: pickSharedCompanyContext(
      source.companyContextPublished,
    ),
    companyContextSchemaVersion: source.companyContextSchemaVersion,
    companyContextDraftHash,
    companyContextPublishedVersion: source.companyContextPublishedVersion,
    companyContextPublishedHash: source.companyContextPublishedHash,
    companyContextPublishedAt: source.companyContextPublishedAt,
  };
}
