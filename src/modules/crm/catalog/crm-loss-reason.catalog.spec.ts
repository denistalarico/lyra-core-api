import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import {
  CRM_SHARED_LOSS_REASONS,
  resolveCrmLossReasons,
} from './crm-loss-reason.catalog';

describe('resolveCrmLossReasons', () => {
  it('returns only the shared reasons for an unknown or absent mode', () => {
    const codes = resolveCrmLossReasons(null).map((reason) => reason.code);
    expect(codes).toEqual(CRM_SHARED_LOSS_REASONS.map((reason) => reason.code));
    expect(resolveCrmLossReasons('made_up_mode')).toEqual(
      resolveCrmLossReasons(null),
    );
  });

  it('offers the mode-specific reasons before the shared ones', () => {
    const reasons = resolveCrmLossReasons(LeadFlowBusinessMode.RealEstate);
    expect(reasons[0]).toMatchObject({
      code: 'financing_denied',
      scope: 'business_mode',
    });
    expect(reasons.some((reason) => reason.code === 'no_budget')).toBe(true);
  });

  it('deduplicates by code so a shared reason is never listed twice', () => {
    const codes = resolveCrmLossReasons(
      LeadFlowBusinessMode.RetailStore,
    ).map((reason) => reason.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
