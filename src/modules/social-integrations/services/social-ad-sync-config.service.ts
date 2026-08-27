import { Injectable } from '@nestjs/common';

export const SOCIAL_ADS_SYNC_ENABLED_ENV = 'SOCIAL_ADS_SYNC_ENABLED';
export const SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV =
  'SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS';

/** How far back a daily run re-reads, when nothing says otherwise. */
const DEFAULT_DAILY_LOOKBACK_DAYS = 7;

/**
 * Bounds on the lookback, not a preference.
 *
 * The floor is 1 because a daily run that covers no days is not a daily run.
 * The ceiling is 90 because that is both Meta's restatement horizon and the
 * window validator's own limit — a larger value would produce a run that the
 * insights path refuses every single morning, and the refusal would be filed
 * against the connection rather than against the configuration that caused it.
 */
const MIN_DAILY_LOOKBACK_DAYS = 1;
const MAX_DAILY_LOOKBACK_DAYS = 90;

/**
 * Configuration for the Social ad sync queue.
 *
 * **The contract, stated plainly: edit `.env`, restart the API, and the new
 * value takes effect.** Nothing here watches the file. `process.env` is a
 * snapshot taken when the process started, so a running Node process cannot
 * see an edit to `.env` no matter how often it reads `process.env` — and this
 * is not a dynamic kill switch. Turning the sync off in production means
 * changing the variable and restarting the service.
 *
 * The getters read `process.env` per call rather than caching in the
 * constructor, which buys two real things and one imaginary one. Real: tests
 * can set a value and observe it without rebuilding the service, and a future
 * runtime setting has one place to intercept. Imaginary: it does *not* pick up
 * `.env` edits, and no comment, test or document here may suggest it does.
 *
 * Future debt, deliberately not taken on in this slice: a Lyra Admin runtime
 * setting — a stored value, read per tick, changeable without a deploy — would
 * make this a genuinely dynamic switch. Until that exists, the switch is an
 * environment variable with an environment variable's lifecycle.
 *
 * Two knobs, both with a consumer. There is deliberately no interval, batch
 * size or lease duration here: those are constants in the worker, and a knob
 * nobody turns is a knob whose value nobody validates.
 */
@Injectable()
export class SocialAdSyncConfigService {
  /**
   * Whether the queue runs at all. Takes effect on the next process start.
   *
   * Defaults to **true**, so a deployment that never heard of this variable
   * behaves like a working product. Only an explicit, recognizable "off" turns
   * it off — a typo reads as `true`, which is the safe direction for a switch
   * whose failure mode in the other direction is a silently dead sync.
   */
  get enabled(): boolean {
    const raw = process.env[SOCIAL_ADS_SYNC_ENABLED_ENV]?.trim().toLowerCase();

    if (raw === undefined || raw === '') return true;

    return !['false', '0', 'no', 'off'].includes(raw);
  }

  /** Days a daily run re-reads, ending at the account's last settled day. */
  get dailyLookbackDays(): number {
    const raw = process.env[SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV]?.trim();

    if (!raw) return DEFAULT_DAILY_LOOKBACK_DAYS;

    const parsed = Number(raw);

    // A value that is not a whole number of days is a configuration mistake,
    // and guessing what was meant would silently change how much history the
    // scheduler re-reads every morning.
    if (!Number.isInteger(parsed)) return DEFAULT_DAILY_LOOKBACK_DAYS;

    return Math.min(
      MAX_DAILY_LOOKBACK_DAYS,
      Math.max(MIN_DAILY_LOOKBACK_DAYS, parsed),
    );
  }
}
