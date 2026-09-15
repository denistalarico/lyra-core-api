import { evaluateSocialCampaignMonitorRules } from './social-campaign-monitor-rules';

describe('evaluateSocialCampaignMonitorRules', () => {
  it('uses inclusive integer boundaries for spend and balance', () => {
    const result = evaluateSocialCampaignMonitorRules(
      {
        dailySpendLimitMinor: '10000',
        monthlySpendLimitMinor: '50000',
        balanceFloorMinor: '2000',
      },
      {
        day: '2026-09-15',
        month: '2026-09',
        dailySpendMinor: '10000',
        monthlySpendMinor: '50001',
        balanceMinor: '2000',
      },
    );

    expect(result.map((condition) => condition.triggered)).toEqual([
      true,
      true,
      true,
    ]);
    expect(result.map((condition) => condition.periodKey)).toEqual([
      '2026-09-15',
      '2026-09',
      'current',
    ]);
  });

  it('does not invent a zero when the local mirror has no observation', () => {
    const result = evaluateSocialCampaignMonitorRules(
      {
        dailySpendLimitMinor: '10000',
        monthlySpendLimitMinor: null,
        balanceFloorMinor: '2000',
      },
      {
        day: '2026-09-15',
        month: '2026-09',
        dailySpendMinor: null,
        monthlySpendMinor: null,
        balanceMinor: null,
      },
    );

    expect(result).toEqual([]);
  });

  it('does not trigger values still inside their guardrails', () => {
    const result = evaluateSocialCampaignMonitorRules(
      {
        dailySpendLimitMinor: '10000',
        monthlySpendLimitMinor: '50000',
        balanceFloorMinor: '2000',
      },
      {
        day: '2026-09-15',
        month: '2026-09',
        dailySpendMinor: '9999',
        monthlySpendMinor: '49999',
        balanceMinor: '2001',
      },
    );

    expect(result.every((condition) => !condition.triggered)).toBe(true);
  });
});
