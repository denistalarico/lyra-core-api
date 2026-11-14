/**
 * D-G8: GA4 has its own kill switch, **default off** until the authenticated
 * smoke. An unset variable means disabled; editing `.env` requires a restart.
 */
export const SOCIAL_GA4_SYNC_ENABLED_ENV = 'SOCIAL_GA4_SYNC_ENABLED';

export function isGa4SyncEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[SOCIAL_GA4_SYNC_ENABLED_ENV]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/** Daily run re-reads D-3→D-1 because GA4 restates recent days (§7.2). */
export const GA4_DAILY_LOOKBACK_DAYS = 3;
/** First sync of a property reads this much closed history. */
export const GA4_BACKFILL_DAYS = 30;
/** Manual window ceiling: "janela curta" (G3 §8.3). */
export const GA4_MANUAL_MAX_WINDOW_DAYS = 31;
/** The property's local hour after which yesterday is worth reading. */
export const GA4_LOCAL_START_HOUR = 4;
/** A `processing` run older than this is a dead worker, not a live lock. */
export const GA4_STALE_RUN_MINUTES = 15;
