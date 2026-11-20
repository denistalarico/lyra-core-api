import type {
  GoogleAdsConversionCrm,
  GoogleAdsConversionKind,
} from './entities/google-ads-conversion-upload.entity';

/**
 * GA-CONV (D-G6, revised 2026-11-20): pure rules of the conversion upload, so
 * the worker's SQL stays a data fetch and every decision is specced here.
 */

/** D-G6: only clicks younger than this are uploaded. */
export const GCLID_MAX_AGE_DAYS = 90;
/** First try + 5 retries (D-G6). Delay before retry n is `RETRY_DELAYS_MS[n-1]`. */
export const MAX_UPLOAD_ATTEMPTS = 6;
export const RETRY_DELAYS_MS = [
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  24 * 3_600_000,
] as const;

export const CONVERSION_ACTION_RESOURCE =
  /^customers\/(\d+)\/conversionActions\/(\d+)$/;

/** What the worker reads of an opportunity, in either CRM. No PII. */
export type ConversionOpportunity = {
  crm: GoogleAdsConversionCrm;
  id: string;
  status: string;
  pipelineId: string;
  /** Agency `position` / LeadFlow `sort_order` of the current stage. */
  stagePosition: number | null;
  stageIsLost: boolean;
  wonAt: Date | null;
  /** Major units (e.g. reais). */
  valueAmount: number | null;
  currency: string | null;
};

/** pipelineId → position of the stage configured as "qualified" in it. */
export type QualifiedThresholds = ReadonlyMap<string, number>;

/**
 * Which conversions an opportunity has earned now.
 * - won → qualified and won (a sale was qualified, even if it skipped the stage);
 * - open, not in a lost stage, at or past the funnel's qualified stage →
 *   qualified. "At or past" keeps a card that moved on between two sweeps.
 */
export function earnedConversions(
  opportunity: ConversionOpportunity,
  thresholds: QualifiedThresholds,
): GoogleAdsConversionKind[] {
  if (opportunity.status === 'won') return ['qualified', 'won'];
  if (opportunity.status !== 'open' || opportunity.stageIsLost) return [];
  const threshold = thresholds.get(opportunity.pipelineId);
  if (threshold === undefined || opportunity.stagePosition === null) return [];
  return opportunity.stagePosition >= threshold ? ['qualified'] : [];
}

export function transactionIdFor(
  opportunityId: string,
  kind: GoogleAdsConversionKind,
): string {
  return `${opportunityId}:${kind}`;
}

/**
 * When the conversion happened. Won uses the CRM's close time; qualified has
 * no stage history in the Agency CRM, so the sweep's own time stands in. The
 * Data Manager refuses a conversion before the click or in the future.
 */
export function conversionMoment(
  kind: GoogleAdsConversionKind,
  opportunity: ConversionOpportunity,
  clickAt: Date,
  now: Date,
): Date {
  const candidate =
    kind === 'won' && opportunity.wonAt ? opportunity.wonAt : now;
  if (candidate.getTime() <= clickAt.getTime()) return now;
  if (candidate.getTime() > now.getTime()) return now;
  return candidate;
}

/** The opportunity value goes only with "won", only when the setting allows. */
export function conversionValueFor(
  kind: GoogleAdsConversionKind,
  opportunity: ConversionOpportunity,
  sendValue: boolean,
): { value: number | null; currency: string | null } {
  if (kind !== 'won' || !sendValue) return { value: null, currency: null };
  const amount = opportunity.valueAmount;
  if (amount === null || !Number.isFinite(amount) || amount <= 0)
    return { value: null, currency: null };
  const currency = (opportunity.currency ?? '').trim().toUpperCase();
  return {
    value: Math.round(amount * 100) / 100,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'BRL',
  };
}

/** After `attempts` tries failed in a retryable way: next try, or null = give up. */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_UPLOAD_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MS[Math.max(0, attempts - 1)];
  return new Date(now.getTime() + delay);
}

/** `customers/1/conversionActions/2` → `2`. */
export function conversionActionIdOf(resource: string): string | null {
  return CONVERSION_ACTION_RESOURCE.exec(resource)?.[2] ?? null;
}

/** `customers/123` → `123` (Google Ads conversion customer). */
export function customerIdOf(resource: unknown): string | null {
  return typeof resource === 'string'
    ? (/^customers\/(\d{1,20})$/.exec(resource)?.[1] ?? null)
    : null;
}
