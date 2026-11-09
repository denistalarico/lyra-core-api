import { Injectable, Logger } from '@nestjs/common';

export type SocialPlanContentChange = {
  tenantId: string;
  workspaceId: string;
  contentItemIds: readonly string[];
};

export type SocialPlanContentChangeObserver = (
  change: SocialPlanContentChange,
) => Promise<void>;

/**
 * AR4 — "these content items changed", for domains that keep work derived from
 * them (D-25). Same seam as `SocialApprovalTransitionRegistry` (D-30): the
 * Planner declares it and never imports a consumer, and a join module fills it
 * on init.
 *
 * Told after the write has committed and best-effort: a failing observer never
 * fails a Planner write, and observers re-read the items instead of trusting
 * this payload, so a missed call is repaired by their own reconciliation.
 */
@Injectable()
export class SocialPlanContentChangeRegistry {
  private readonly logger = new Logger(SocialPlanContentChangeRegistry.name);
  private readonly observers: SocialPlanContentChangeObserver[] = [];

  register(observer: SocialPlanContentChangeObserver): void {
    this.observers.push(observer);
  }

  async notify(change: SocialPlanContentChange): Promise<void> {
    if (change.contentItemIds.length === 0) return;
    for (const observer of this.observers)
      try {
        await observer(change);
      } catch (error) {
        this.logger.warn(
          `content change observer failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
  }
}
