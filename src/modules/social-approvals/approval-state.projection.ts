import type { SocialApprovalRequestEntity } from './entities';

/** Agency state read model: official workflow values, without comments or decisions. */
export type SocialApprovalStateProjection = {
  approvalId: string;
} & Pick<
  SocialApprovalRequestEntity,
  | 'status'
  | 'currentStage'
  | 'createdAt'
  | 'sentToClientAt'
  | 'approvedAt'
  | 'cancelledAt'
  | 'supersededAt'
>;
