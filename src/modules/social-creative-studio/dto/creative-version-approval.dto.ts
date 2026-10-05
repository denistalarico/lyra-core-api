import type { SocialApprovalStateProjection } from '../../social-approvals/approval-state.projection';

/** Derived from Approvals for one authorized immutable Creative Asset Version. */
export type CreativeVersionApprovalProjection = SocialApprovalStateProjection;

export type CreativeVersionApprovalResponse = {
  approval: CreativeVersionApprovalProjection | null;
};
