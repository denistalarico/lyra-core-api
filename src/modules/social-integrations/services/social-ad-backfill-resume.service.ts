import { Injectable, Logger } from '@nestjs/common';
import { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import { planBackfillChunks } from '../sync/social-ad-backfill-plan';
import { SocialAdBackfillResumeError } from '../sync/social-ad-sync-run.error';
import { SocialAdSyncDisabledError } from '../sync/social-ad-sync-run.error';
import { INSIGHTS_ENTITY_LEVELS } from '../sync/social-ad-sync-run.contract';
import {
  groupOutcomesByWindow,
  resolveChunkState,
} from './social-ad-backfill-planner.service';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import {
  SocialAdSyncRunService,
  type EnqueueSyncRunResult,
} from './social-ad-sync-run.service';

/**
 * Retries the one window a backfill chain is stuck on.
 *
 * ## Why this exists at all
 *
 * A chunk is covered only by a `backfill` run that succeeded, and the planner
 * refuses to re-attempt a window whose runs have all settled. Those two rules
 * together are what stop a broken week from being papered over — but they also
 * mean a stalled chain never moves again on its own. This is the deliberate act
 * that moves it, and it is deliberate on purpose: an automatic re-attempt every
 * hour is exactly the behaviour the retry policy already implements and gave up
 * on.
 *
 * ## Why not just re-run the window manually
 *
 * Because a `manual` sync of the same days writes the same facts and must
 * *not* advance the chain. If it did, "complete" would once again mean "facts
 * are present for these days", which is the claim this whole design rejects:
 * facts prove metrics exist, never that a window was read. So the resume path
 * creates a run of kind `backfill` with the chunk's own boundaries — the same
 * kind, the same window, a new attempt — and the chain's own rules then see it.
 *
 * ## What it does not do
 *
 * It reads nothing from Meta. It writes one row and returns it; the S2.5 worker
 * claims it, executes it under the existing lease, and retries it under the
 * existing policy. The endpoint takes no dates, so there is no window a caller
 * can name — the chunk's boundaries come from the plan, which is derived from
 * the chain's own anchor. A caller who wants an arbitrary window already has
 * the manual sync endpoint, and that one deliberately cannot certify coverage.
 */
@Injectable()
export class SocialAdBackfillResumeService {
  private readonly logger = new Logger(SocialAdBackfillResumeService.name);

  constructor(
    private readonly config: SocialAdSyncConfigService,
    private readonly runService: SocialAdSyncRunService,
    private readonly credentialResolver: SocialAdCredentialResolver,
  ) {}

  async resume(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string | null;
    connectionId: string;
    requestedById: string | null;
  }): Promise<EnqueueSyncRunResult> {
    /**
     * The kill switch, before anything else and for the same reason the manual
     * endpoint checks it: a queue that accepts work while nothing drains it
     * answers success to every request and looks exactly like a stuck worker.
     */
    if (!this.config.enabled) {
      throw new SocialAdSyncDisabledError();
    }

    const totalDays = this.config.backfillDays;

    if (totalDays <= 0) {
      throw new SocialAdBackfillResumeError('backfill_chain_disabled');
    }

    /**
     * The scope boundary, and it is the same one every other endpoint uses.
     *
     * Tenant, workspace and managed client are re-read from the connection row
     * rather than trusted from the request; a connection belonging to another
     * tenant does not resolve, so this refuses with the resolver's own
     * not-found rather than revealing that the id exists.
     */
    const credential = await this.credentialResolver.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      connectionId: input.connectionId,
    });

    const outcomes = await this.runService.listBackfillChunkOutcomes(
      credential.connectionId,
    );

    // No chain to resume. The scheduler starts one by itself once the account
    // is ready, and inventing one here would bypass the hierarchy run the chain
    // normally begins with.
    if (outcomes.length === 0) {
      throw new SocialAdBackfillResumeError('backfill_chain_missing');
    }

    /**
     * The same anchor the planner derives, from the same ordered read.
     *
     * Resuming must not move it. The window this creates has to be a chunk of
     * the *existing* plan — a boundary computed from today would produce a run
     * that covers days belonging to two different chunks, and the chain would
     * then never see its stalled window as covered.
     */
    const anchor = outcomes[0].until;

    const chunks = planBackfillChunks({
      anchor,
      totalDays,
      chunkDays: this.config.backfillChunkDays,
    });

    const byWindow = groupOutcomesByWindow(outcomes);

    const target = chunks.find(
      (chunk) =>
        resolveChunkState(byWindow.get(chunk.until) ?? []) !== 'covered',
    );

    if (!target) {
      throw new SocialAdBackfillResumeError('backfill_chain_complete');
    }

    const state = resolveChunkState(byWindow.get(target.until) ?? []);

    /**
     * Only a stalled chunk may be resumed.
     *
     * `in_flight` is already being worked on — the enqueue below would dedupe
     * against it anyway, but refusing says so plainly instead of returning a
     * run the caller did not cause. `not_started` means the chain is simply
     * waiting its turn behind the piece in front of it, and forcing that window
     * now would put two chunks in the queue at once, which is the fairness rule
     * this feature is built on.
     *
     * A window whose only runs succeeded at a narrower level set — the shape
     * every pre-I3.4 chunk has — reads as `not_started` too, and refusing it
     * here is the right answer rather than an oversight. Nothing about it is
     * stuck: the chain re-fetches it on its own, one chunk at a time, and an
     * operator resuming thirteen such windows by hand would only race it.
     */
    if (state !== 'stalled') {
      throw new SocialAdBackfillResumeError('backfill_chain_not_stalled');
    }

    /**
     * A fresh attempt at the same window, as a `backfill` run.
     *
     * `enqueue` composes the idempotency key and lets the partial unique index
     * decide, so two operators clicking resume at the same moment get one run
     * rather than two — the same deduplication the manual endpoint relies on.
     * Scope and provider come from the resolved row, never from the request.
     */
    const result = await this.runService.enqueue({
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      runKind: 'backfill',
      windowStart: target.since,
      windowEnd: target.until,
      entityLevels: INSIGHTS_ENTITY_LEVELS,
      // Unlike the chain's own chunks, this one was asked for by a person.
      requestedById: input.requestedById,
    });

    this.logger.log(
      `Social ad backfill resumed: ${JSON.stringify({
        connectionId: credential.connectionId,
        runId: result.run.id,
        chunk: target.index,
        since: target.since,
        until: target.until,
        deduplicated: result.deduplicated,
      })}`,
    );

    return result;
  }
}
