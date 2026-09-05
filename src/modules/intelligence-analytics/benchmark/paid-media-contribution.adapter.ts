import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  TelemetryContributionRegistry,
  type TelemetryContribution,
  type TelemetryContributionScope,
  type TelemetryContributionSource,
} from '../../leadflow-privacy';
import { BusinessModeDimensionAdapter } from '../../leadflow-analytics/intelligence/business-mode-dimension.adapter';
import { BENCHMARK_SYSTEM_BUSINESS_MODES } from '../../leadflow-analytics/intelligence/benchmark-business-mode-vocabulary';
import { isBenchmarkEligibleBusinessMode } from '../../../common/intelligence';
import { PaidMediaContributionService } from './paid-media-contribution.service';

/**
 * Social paid media, as a contributor to the consented telemetry snapshot.
 *
 * The seam between two things that must not merge: the privacy module owns
 * *whether* a context contributes, and this owns *what* a contributing context
 * has to say. It is deliberately thin — resolve the mode, check eligibility,
 * delegate the arithmetic — because everything it does is a decision that had to
 * live somewhere neither half could reach on its own.
 *
 * ## Why business mode is resolved here rather than in the builder
 *
 * The builder is arithmetic over Social's own tables and has no business asking
 * LeadFlow anything. The privacy module cannot resolve it either: the mode is
 * an *eligibility* concept belonging to the benchmark, not to consent, and a
 * privacy module that knew about business modes would be one release away from
 * knowing about cohorts. Intelligence is the module that already imports both,
 * so it is where the two facts meet.
 *
 * ## The contribution is the snapshot (§6, and I5's open question)
 *
 * The mode is read *now* and stamped into the rows produced *now*. Nothing
 * rewrites yesterday. A context that switches from clinic to restaurant today
 * has its earlier days still counted under clinic — which is correct, because
 * those days really were run as a clinic, and it is also the only honest option
 * available: `leadflow_client_settings.business_mode_key` is a mutable column
 * with no history, so a retroactive relabel would be a claim nobody can
 * substantiate. `BusinessModeTemporalSemantics` names this the
 * `current_context_dimension` and warns that I6 must choose explicitly; this is
 * the choice, and it converts that dimension into a durable per-day fact.
 */
@Injectable()
export class PaidMediaContributionAdapter
  implements TelemetryContributionSource, OnModuleInit
{
  /** Names the domain in the audit trail, not the metric family. */
  readonly contributionSourceKey = 'social_paid_media';

  constructor(
    private readonly contributions: PaidMediaContributionService,
    private readonly businessModes: BusinessModeDimensionAdapter,
    private readonly registry: TelemetryContributionRegistry,
  ) {}

  /**
   * Announces this domain as a contributor once the graph is built.
   *
   * Registration rather than injection into the collector, because the
   * dependency may only run this way: privacy must not import Intelligence. The
   * collector still decides everything that matters — this only makes the
   * builder reachable, and a snapshot with no valid consent never calls it.
   */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async buildContributions(input: {
    scope: TelemetryContributionScope;
    since: string;
    until: string;
  }): Promise<TelemetryContribution[]> {
    const dimension = await this.businessModes.businessMode(input.scope);

    /**
     * Ineligible modes contribute nothing at all — not an `unknown` cohort.
     *
     * The distinction matters and is easy to get backwards. An unrecognised
     * *destination* becomes `unknown` because dropping it would bias the
     * benchmark toward advertisers running older campaign types; the cohort is
     * still a real, comparable group. An unrecognised *business mode* is the
     * opposite: pooling every tenant-custom mode into one bucket would create a
     * cohort whose members have agreed on nothing, and publish it as though
     * they had. Two tenants that both wrote "clínicas" have not defined the
     * same business.
     *
     * `custom`, `unknown_key` and `unconfigured` therefore all return empty,
     * and §4's prohibition on mapping custom modes to official ones by label is
     * satisfied structurally: there is no branch here that could grow one.
     */
    if (
      dimension.resolution !== 'configured' ||
      !isBenchmarkEligibleBusinessMode(
        dimension.key,
        BENCHMARK_SYSTEM_BUSINESS_MODES,
      )
    ) {
      return [];
    }

    return this.contributions.buildContributions({
      scope: {
        tenantId: input.scope.tenantId,
        workspaceId: input.scope.workspaceId,
        agencyClientId: input.scope.agencyClientId,
      },
      // Non-null by the guard above: `isBenchmarkEligibleBusinessMode` rejects
      // null, and `configured` implies a key.
      businessModeKey: dimension.key as string,
      since: input.since,
      until: input.until,
    });
  }
}
