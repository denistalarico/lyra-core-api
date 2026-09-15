import type { SocialCampaignAlertType } from '../entities';

export type SocialCampaignMonitorSnapshot = {
  day: string;
  month: string;
  dailySpendMinor: string | null;
  monthlySpendMinor: string | null;
  balanceMinor: string | null;
};

export type SocialCampaignMonitorLimits = {
  dailySpendLimitMinor: string | null;
  monthlySpendLimitMinor: string | null;
  balanceFloorMinor: string | null;
};

export type SocialCampaignMonitorCondition = {
  type: SocialCampaignAlertType;
  periodKey: string;
  currentValueMinor: string;
  thresholdMinor: string;
  triggered: boolean;
};

/** Pure rule evaluation: no AI, provider call, implicit default or floating point. */
export function evaluateSocialCampaignMonitorRules(
  limits: SocialCampaignMonitorLimits,
  snapshot: SocialCampaignMonitorSnapshot,
): SocialCampaignMonitorCondition[] {
  const conditions: SocialCampaignMonitorCondition[] = [];

  addCondition(
    conditions,
    'daily_spend_limit',
    snapshot.day,
    snapshot.dailySpendMinor,
    limits.dailySpendLimitMinor,
    (current, threshold) => current >= threshold,
  );
  addCondition(
    conditions,
    'monthly_spend_limit',
    snapshot.month,
    snapshot.monthlySpendMinor,
    limits.monthlySpendLimitMinor,
    (current, threshold) => current >= threshold,
  );
  addCondition(
    conditions,
    'low_balance',
    'current',
    snapshot.balanceMinor,
    limits.balanceFloorMinor,
    (current, threshold) => current <= threshold,
  );

  return conditions;
}

function addCondition(
  output: SocialCampaignMonitorCondition[],
  type: SocialCampaignAlertType,
  periodKey: string,
  current: string | null,
  threshold: string | null,
  compare: (current: bigint, threshold: bigint) => boolean,
) {
  if (current === null || threshold === null) return;
  output.push({
    type,
    periodKey,
    currentValueMinor: current,
    thresholdMinor: threshold,
    triggered: compare(BigInt(current), BigInt(threshold)),
  });
}
