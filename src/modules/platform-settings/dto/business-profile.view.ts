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
 */
export function mapBusinessProfileResponse(
  source: LeadFlowClientSettingsResponse,
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
    companyContextPublishedVersion: source.companyContextPublishedVersion,
    companyContextPublishedHash: source.companyContextPublishedHash,
    companyContextPublishedAt: source.companyContextPublishedAt,
  };
}
