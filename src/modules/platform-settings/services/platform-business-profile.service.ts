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
//
// `CompanyContextService` is injected read-only, to compute
// `companyContextDraftHash` for every response using the exact same
// `hash(normalizePersisted(draft))` pair
// `LeadFlowClientSettingsService.publishCompanyContext` uses internally to
// check `expectedDraftHash` — so a value this service hands back is
// guaranteed to match what publish actually validates (S1.4.3b).
// This service never calls `CompanyContextService.normalize()` (the
// mutating/validating variant) and never persists anything through it —
// persistence still only ever happens inside `LeadFlowClientSettingsService`.

import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowClientSettingsService } from '../../leadflow-settings/services/leadflow-client-settings.service';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import type { LeadFlowClientSettingsResponse } from '../../leadflow-settings/dto/leadflow-client-settings-response.dto';
import {
  BusinessProfileResponse,
  mapBusinessProfileResponse,
} from '../dto/business-profile.view';
import { UpdateBusinessProfileDto } from '../dto/update-business-profile.dto';
import {
  buildSharedSurfacePublishDocument,
  mergeSharedCompanyContext,
} from './company-context-shared-projection';

@Injectable()
export class PlatformBusinessProfileService {
  constructor(
    private readonly leadFlowClientSettingsService: LeadFlowClientSettingsService,
    private readonly companyContextService: CompanyContextService,
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

    return this.mapResponse(settings);
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

    return this.mapResponse(updated);
  }

  /**
   * Publishes **only the shared surface** of the stored draft (S1.4.3d).
   *
   * There is no `companyContextDraft` argument here on purpose: unlike
   * `updateBusinessProfile`, publish never takes a body to merge — it
   * publishes whatever is already persisted, which is what
   * `expectedDraftHash` exists to guard (S1.4.3a).
   *
   * The write itself still runs through the exact same
   * `publishCompanyContext` the two LeadFlow controllers call — same
   * transaction, same pessimistic lock, same normalize/hash/version/
   * `publishedAt`/snapshot/outbox effects. The only thing this path changes is
   * *which document* gets published, supplied through that method's
   * `resolvePublishedDocument` hook:
   *
   *   - With a published baseline: shared fields of the draft overlaid onto
   *     the current published document. Every LeadFlow-only subtree stays
   *     exactly as last published, so a pending hidden draft edit is never
   *     promoted by a caller who could not see it. It stays in the draft and
   *     LeadFlow can publish it later.
   *   - Without one (first publish): shared fields of the draft overlaid onto
   *     the *current* Business Mode's canonical context defaults. S1.4.3c
   *     established that no trustworthy historical baseline exists, so rather
   *     than reconstruct one — or block the first publish outright, which
   *     would strand every Social-only client, since every Business Mode
   *     seeds LeadFlow-only defaults — the domains Platform does not control
   *     take the defaults the mode ships today.
   *
   * `expectedDraftHash` is still validated against the hash of the **full**
   * draft inside that transaction: publishing a subset does not narrow what
   * counts as a concurrent change, so a hidden-only edit landing between load
   * and publish still conflicts. That is deliberate.
   */
  async publishCompanyContext(
    ctx: RequestContext,
    agencyClientId: string | null,
    expectedDraftHash: string | undefined,
  ): Promise<BusinessProfileResponse> {
    const updated =
      await this.leadFlowClientSettingsService.publishCompanyContext(
        ctx,
        agencyClientId ?? undefined,
        expectedDraftHash,
        async ({
          normalizedDraft,
          normalizedPublished,
          hasPublishedBaseline,
          businessModeKey,
        }) => {
          const base = hasPublishedBaseline
            ? normalizedPublished
            : await this.leadFlowClientSettingsService.getBusinessModeContextDefaults(
                ctx,
                businessModeKey,
              );

          return buildSharedSurfacePublishDocument(normalizedDraft, base);
        },
      );

    return this.mapResponse(updated);
  }

  private getCurrentSettings(
    ctx: RequestContext,
    agencyClientId: string | null,
  ): Promise<LeadFlowClientSettingsResponse> {
    return agencyClientId
      ? this.leadFlowClientSettingsService.getSettings(ctx, agencyClientId)
      : this.leadFlowClientSettingsService.getAgencySettings(ctx);
  }

  /**
   * Single place that turns a `LeadFlowClientSettingsResponse` into the
   * sanitized `BusinessProfileResponse`, computing `companyContextDraftHash`
   * the same way `publishCompanyContext` computes the value it checks
   * `expectedDraftHash` against: `hash(normalizePersisted(draft))`. Reusing
   * that exact pair — not a new hashing routine — is what guarantees a hash
   * this service hands back will always be accepted back as
   * `expectedDraftHash`, as long as nothing else changed the draft meanwhile.
   */
  private mapResponse(
    source: LeadFlowClientSettingsResponse,
  ): BusinessProfileResponse {
    const draftHash = this.companyContextService.hash(
      this.companyContextService.normalizePersisted(
        source.companyContextDraft ?? {},
      ),
    );

    return mapBusinessProfileResponse(source, draftHash);
  }
}
