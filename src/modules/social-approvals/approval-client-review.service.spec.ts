import { ApprovalClientReviewService } from './approval-client-review.service';

describe('ApprovalClientReviewService AP2 application boundary', () => {
  const scope = {
    tenantId: 'tenant-a', workspaceId: 'workspace-a', agencyClientId: 'client-a', companyContextId: 'company-a',
  };
  const approvals = {
    markClientViewed: jest.fn(), clientComment: jest.fn(), clientApprove: jest.fn(), clientRequestChanges: jest.fn(),
  };
  const service = new ApprovalClientReviewService(approvals as never);

  beforeEach(() => jest.clearAllMocks());

  it('forwards the authenticated real user for the client view, comment, approval and changes boundaries', async () => {
    await service.view(scope, 'approval-a', 'client-user');
    await service.comment(scope, 'approval-a', 'client-user', 'Comentário do cliente');
    await service.approve(scope, 'approval-a', 'client-user');
    await service.requestChanges(scope, 'approval-a', 'client-user', 'Ajustar CTA');

    expect(approvals.markClientViewed).toHaveBeenCalledWith(scope, 'approval-a', 'client-user');
    expect(approvals.clientComment).toHaveBeenCalledWith(scope, 'approval-a', 'client-user', 'Comentário do cliente');
    expect(approvals.clientApprove).toHaveBeenCalledWith(scope, 'approval-a', { type: 'user', userId: 'client-user' });
    expect(approvals.clientRequestChanges).toHaveBeenCalledWith(scope, 'approval-a', { type: 'user', userId: 'client-user' }, 'Ajustar CTA');
  });
});
