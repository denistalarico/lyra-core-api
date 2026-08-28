import { Injectable } from '@nestjs/common';

export const SOCIAL_ADS_RETENTION_ENABLED_ENV = 'SOCIAL_ADS_RETENTION_ENABLED';
export const SOCIAL_ADS_RETENTION_BATCH_SIZE_ENV =
  'SOCIAL_ADS_RETENTION_BATCH_SIZE';

const DEFAULT_BATCH_SIZE = 1000;

/**
 * A floor of 1 because a batch of zero would make the sweep a no-op that still
 * logs as if it ran, which is worse than the switch — it looks healthy. The
 * ceiling is 10 000 because the batch is one `DELETE` holding row locks for its
 * duration, and a sweep large enough to be felt by the sync queue defeats the
 * purpose of batching at all.
 */
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10_000;

/**
 * Configuration for the sync-run retention sweep.
 *
 * Two knobs, deliberately. The retention *periods* are constants in
 * `social-ad-retention.policy.ts` rather than environment variables: there are
 * eight of them, they encode a policy rather than a preference, and each one
 * turned into a knob would be a value with no validation, no test and no
 * documented meaning — while making the question "how long do we keep failed
 * runs?" unanswerable without reading a specific machine's environment.
 *
 * Same lifecycle as `SocialAdSyncConfigService`, and the same caveat: getters
 * read `process.env` per call so tests can set a value, but `process.env` is a
 * snapshot from process start. **Editing `.env` requires a restart.** Nothing
 * here watches the file, and nothing in this class should ever be described as
 * a dynamic switch.
 */
@Injectable()
export class SocialAdRetentionConfigService {
  /**
   * Whether the sweep deletes anything at all.
   *
   * Its own variable, never `SOCIAL_ADS_SYNC_ENABLED`. The two answer different
   * questions and the wrong coupling is dangerous in both directions: pausing
   * the sync to investigate a provider incident must not also stop housekeeping
   * indefinitely, and — far worse — a deployment that turns the *sync* on for
   * the first time must not silently also authorize its first deletion.
   *
   * Defaults to **true**, matching the sync switch: a deployment that has never
   * heard of this variable gets a working product rather than a table that
   * grows forever. Only an explicit, recognizable "off" turns it off, so a typo
   * reads as enabled — and the failure mode of an unintended `true` here is
   * bounded, because every rule in the policy is conservative and the facts are
   * out of reach by construction.
   */
  get enabled(): boolean {
    const raw =
      process.env[SOCIAL_ADS_RETENTION_ENABLED_ENV]?.trim().toLowerCase();

    if (raw === undefined || raw === '') return true;

    return !['false', '0', 'no', 'off'].includes(raw);
  }

  /** Rows one sweep may delete. Bounded so a sweep cannot monopolize the DB. */
  get batchSize(): number {
    const raw = process.env[SOCIAL_ADS_RETENTION_BATCH_SIZE_ENV]?.trim();

    if (!raw) return DEFAULT_BATCH_SIZE;

    const parsed = Number(raw);

    // A non-integer is a configuration mistake, and rounding it would silently
    // choose a batch size nobody wrote down.
    if (!Number.isInteger(parsed)) return DEFAULT_BATCH_SIZE;

    return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, parsed));
  }
}
