import { BadRequestException } from '@nestjs/common';
import {
  approvalScopeKind,
  approvalStagesFor,
  internalApprovalIsFinal,
} from './approval-stage.policy';

describe('approval stage policy (CS5 Closeout)', () => {
  const own = { agencyClientId: null, companyContextId: null };
  const managed = { agencyClientId: 'client-a', companyContextId: 'company-a' };
  const legacy = { agencyClientId: 'client-a', companyContextId: null };

  it('own scope (agency or B2B producing for itself) is internal only', () => {
    expect(approvalScopeKind(own)).toBe('own');
    expect(approvalStagesFor(own)).toEqual(['internal']);
    expect(internalApprovalIsFinal(own)).toBe(true);
  });

  it('a managed client walks internal → client', () => {
    expect(approvalScopeKind(managed)).toBe('managed_client');
    expect(approvalStagesFor(managed)).toEqual(['internal', 'client']);
    expect(internalApprovalIsFinal(managed)).toBe(false);
  });

  it('refuses legacy (client, null) with company_context_required', () => {
    expect(() => approvalScopeKind(legacy)).toThrow(BadRequestException);
    expect(() => approvalStagesFor(legacy)).toThrow(BadRequestException);
  });

  it('returns frozen tables (no caller can mutate the policy)', () => {
    expect(Object.isFrozen(approvalStagesFor(own))).toBe(true);
    expect(Object.isFrozen(approvalStagesFor(managed))).toBe(true);
  });
});
