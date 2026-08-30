// src/modules/platform-settings/services/platform-business-profile.service.ts
//
// Neutral projection of `leadflow_client_settings` for any product that
// shares the Business Profile domain (today: LeadFlow and Social). See
// docs/architecture/social/social-settings-architecture.md §2 for the full
// rationale.
//
// This service intentionally has no repository of its own. Every read and
// write goes through `LeadFlowClientSettingsService`'s existing public
// methods — the same ones `/leadflow/agency/settings` and
// `/leadflow/clients/:id/settings` call — so a Business Mode change made
// through this endpoint runs the exact same invariants (template
// revalidation, `business_mode_template_id` reapointment, company-context
// draft seeding) as one made through LeadFlow. A `repository.save()` here
// would be a second, silently divergent write path; that is exactly what
// D-3/D-2 in social-settings-decisions.md forbid.

import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsService } from '../../leadflow-settings/services/leadflow-client-settings.service';
import type { LeadFlowClientSettingsResponse } from '../../leadflow-settings/dto/leadflow-client-settings-response.dto';
import {
  BusinessProfileResponse,
  mapBusinessProfileResponse,
} from '../dto/business-profile.view';
import { UpdateBusinessProfileDto } from '../dto/update-business-profile.dto';
import { mergeSharedCompanyContext } from './company-context-shared-projection';

@Injectable()
export class PlatformBusinessProfileService {
  constructor(
    private readonly leadFlowClientSettingsService: LeadFlowClientSettingsService,
  ) {}

  /**
   * `agencyClientId` is the active managed context resolved by
   * `PermissionsGuard`/`OperationalContextResolver` from the caller's own
   * product headers — `null` means the agency itself. Callers must not pass
   * an id that was not already authorized for the requesting product; the
   * controller enforces that upstream (see D-15).
   */
  async getBusinessProfile(
    ctx: RequestContext,
    agencyClientId: string | null,
  ): Promise<BusinessProfileResponse> {
    const settings = agencyClientId
      ? await this.leadFlowClientSettingsService.getSettings(
          ctx,
          agencyClientId,
        )
      : await this.leadFlowClientSettingsService.getAgencySettings(ctx);

    return mapBusinessProfileResponse(settings);
  }

  /**
   * `dto.companyContextDraft`, when present, carries only the shared fields
   * the Platform DTO accepts (see `UpdateBusinessProfileDto` and
   * `pickSharedCompanyContext`). `LeadFlowClientSettingsService.
   * applySettingsUpdate` treats `companyContextDraft` as a full replace of
   * the JSONB document — `normalize(dto.companyContextDraft)` — so handing
   * it the shared fields alone would silently erase every LeadFlow-only
   * subtree (`qualification.*`, `service.handoffRules`, ...) already on the
   * row. This method reads the current full draft first and merges the
   * incoming shared fields onto it via `mergeSharedCompanyContext`, so the
   * document that reaches the shared service is always complete.
   */
  async updateBusinessProfile(
    ctx: RequestContext,
    agencyClientId: string | null,
    dto: UpdateBusinessProfileDto,
  ): Promise<BusinessProfileResponse> {
    const patch =
      dto.companyContextDraft !== undefined
        ? {
            ...dto,
            companyContextDraft: mergeSharedCompanyContext(
              (await this.getCurrentSettings(ctx, agencyClientId))
                .companyContextDraft,
              dto.companyContextDraft,
            ),
          }
        : dto;

    const updated = agencyClientId
      ? await this.leadFlowClientSettingsService.updateSettings(
          ctx,
          agencyClientId,
          patch,
        )
      : await this.leadFlowClientSettingsService.updateAgencySettings(
          ctx,
          patch,
        );

    return mapBusinessProfileResponse(updated);
  }

  private getCurrentSettings(
    ctx: RequestContext,
    agencyClientId: string | null,
  ): Promise<LeadFlowClientSettingsResponse> {
    return agencyClientId
      ? this.leadFlowClientSettingsService.getSettings(ctx, agencyClientId)
      : this.leadFlowClientSettingsService.getAgencySettings(ctx);
  }
}
