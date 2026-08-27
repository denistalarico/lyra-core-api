import { Injectable } from '@nestjs/common';

export const SOCIAL_ADS_SYNC_ENABLED_ENV = 'SOCIAL_ADS_SYNC_ENABLED';
export const SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV =
  'SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS';
export const SOCIAL_ADS_SYNC_BACKFILL_DAYS_ENV =
  'SOCIAL_ADS_SYNC_BACKFILL_DAYS';
export const SOCIAL_ADS_SYNC_BACKFILL_CHUNK_DAYS_ENV =
  'SOCIAL_ADS_SYNC_BACKFILL_CHUNK_DAYS';
export const SOCIAL_ADS_SYNC_INTRADAY_INTERVAL_HOURS_ENV =
  'SOCIAL_ADS_SYNC_INTRADAY_INTERVAL_HOURS';

/** How far back a daily run re-reads, when nothing says otherwise. */
const DEFAULT_DAILY_LOOKBACK_DAYS = 7;

/**
 * How much closed history a new connection gets, and in what pieces.
 *
 * Ninety days because that is Meta's own restatement horizon: past it the
 * numbers no longer move, and before it a re-read is the only way to see a
 * conversion that arrived late. Seven-day chunks because a chunk is the unit
 * that retries, and a failed chunk should cost one week rather than one
 * quarter — and because a week of campaign-level rows is a request Meta
 * answers comfortably.
 */
const DEFAULT_BACKFILL_DAYS = 90;
const DEFAULT_BACKFILL_CHUNK_DAYS = 7;

/**
 * How often an unfinished day is re-read.
 *
 * Three hours: enough passes for a working day to have a current number in it,
 * few enough that one account spends six reads a day rather than twenty-four
 * against a quota its neighbours share. The value is hours rather than a cron
 * because it is compared against the *account's* local hour, which the
 * scheduler's own clock cannot express.
 */
const DEFAULT_INTRADAY_INTERVAL_HOURS = 3;

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
 * Five knobs, each with a consumer. There is deliberately no tick interval,
 * batch size, lease duration or intraday start hour here: those are constants
 * in the worker and the scheduler, and a knob nobody turns is a knob whose
 * value nobody validates.
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

  /**
   * Closed days a new connection is backfilled with. `0` turns backfill off.
   *
   * Zero is a supported value and not a mistake: it is how an operator stops
   * new connections from spending an hour of quota on history nobody has asked
   * to see yet, without touching the switch that also stops the daily sync.
   * The ceiling is the same 90 the window validator enforces — a larger value
   * would produce chunks the insights path refuses.
   */
  get backfillDays(): number {
    return this.readInteger({
      name: SOCIAL_ADS_SYNC_BACKFILL_DAYS_ENV,
      fallback: DEFAULT_BACKFILL_DAYS,
      min: 0,
      max: MAX_DAILY_LOOKBACK_DAYS,
    });
  }

  /**
   * Days per backfill chunk, which is also the unit that retries.
   *
   * The floor is 1 because a chunk of zero days would divide the plan into an
   * unbounded number of runs that read nothing. The ceiling is 90 for the same
   * reason as above, and a chunk larger than `backfillDays` is not wrong — it
   * simply makes the plan one chunk.
   */
  get backfillChunkDays(): number {
    return this.readInteger({
      name: SOCIAL_ADS_SYNC_BACKFILL_CHUNK_DAYS_ENV,
      fallback: DEFAULT_BACKFILL_CHUNK_DAYS,
      min: 1,
      max: MAX_DAILY_LOOKBACK_DAYS,
    });
  }

  /**
   * Hours between intraday passes. `0` turns intraday off.
   *
   * Off is a real setting for the same reason as above, and it is the safe one:
   * with intraday disabled the table simply has no rows for today, which is
   * what it had before this slice. The ceiling of 24 is what makes the value a
   * bucket size — an interval longer than a day would give the account's own
   * day a single bucket that never rotates.
   */
  get intradayIntervalHours(): number {
    return this.readInteger({
      name: SOCIAL_ADS_SYNC_INTRADAY_INTERVAL_HOURS_ENV,
      fallback: DEFAULT_INTRADAY_INTERVAL_HOURS,
      min: 0,
      max: 24,
    });
  }

  /**
   * One env var as a bounded whole number.
   *
   * A value that is not an integer falls back rather than being rounded: it is
   * a configuration mistake, and guessing what `7.5` meant would silently
   * change how much history every connection reads. Out-of-range values *are*
   * clamped, because the intent there is unambiguous — somebody asked for more
   * than the pipeline can do, and the answer is the most it can do.
   */
  private readInteger(input: {
    name: string;
    fallback: number;
    min: number;
    max: number;
  }): number {
    const raw = process.env[input.name]?.trim();

    if (!raw) return input.fallback;

    const parsed = Number(raw);

    if (!Number.isInteger(parsed)) return input.fallback;

    return Math.min(input.max, Math.max(input.min, parsed));
  }
}
