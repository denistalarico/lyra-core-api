// src/modules/platform-settings/dto/update-business-profile.dto.ts
//
// Explicit, restrictive DTO for `PATCH /platform/business-profile`
// (Lyra Social S1.4.0). Deliberately not a generic passthrough of
// `UpdateLeadFlowClientSettingsDto`: only the fields the shared-domain
// architecture actually classifies as shared (business-settings-architecture.md
// §1) are accepted here. LeadFlow-only fields (agentConfig, inboxConfig,
// pipelineRef, permissionsConfig, ...) have no path into this endpoint.
//
// `contact.*` is out of scope for S1.4.0 — it lands in S1.4.2 once
// `CompanyContextService` accepts the `contact` root key.
//
// `companyContextDraft` is declared `@IsObject()` rather than a fully typed
// nested DTO because `PlatformBusinessProfileService.updateBusinessProfile`
// runs it through `mergeSharedCompanyContext` before it ever reaches
// `LeadFlowClientSettingsService`: that merge only reads the allowlisted
// shared subfields (`identity.*` minus `legalName`, `service.businessHours`,
// `offers`/`policies`/`faq`/`links`) and silently discards everything else —
// `qualification`, `service.handoffRules`/`serviceLevel`/`emergencyRules`/
// `unsupportedRequests`, `legacyTone`, or any unknown key. A caller sending
// those has no way to make them land on the row.

import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { LeadFlowJsonObject } from '../../leadflow-settings/types/leadflow-settings.types';

export class UpdateBusinessProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessModeKey?: string;

  @IsOptional()
  @IsObject()
  companyContextDraft?: LeadFlowJsonObject;
}
