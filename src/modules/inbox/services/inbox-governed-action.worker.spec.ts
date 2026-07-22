import { InboxGovernedActionWorker } from './inbox-governed-action.worker';

describe('InboxGovernedActionWorker kill switches', () => {
  it('blocks a claimed action when the effect switch is disabled before execution', async () => {
    const action = {
      id: 'action',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      decisionId: 'decision',
      ownershipVersion: 1,
      policyVersion: 'inbox-autonomy-policy-v1',
      actionType: 'reply',
      actionKey: 'reply',
      policyOutcome: 'allowed',
      status: 'planned',
      applicationResult: {},
      appliedAt: null,
      failedAt: null,
      errorCode: null,
    };
    const save = jest.fn((value: unknown) => Promise.resolve(value));
    const update = jest.fn();
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(action),
      save,
      update,
    };
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: action.id }]),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
      getRepository: jest.fn().mockReturnValue(repository),
      query: jest
        .fn()
        .mockResolvedValue([{ open_count: 0, exception_count: 1 }]),
    };
    const outbound = { sendAgentText: jest.fn() };
    const worker = new InboxGovernedActionWorker(
      dataSource as never,
      {
        autoReplyEnabled: false,
        autoCrmEnabled: false,
        autoHandoffEnabled: false,
      } as never,
      outbound as never,
      { transition: jest.fn() } as never,
    );

    await worker.processOnce('test-worker');

    expect(outbound.sendAgentText).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
        errorCode: 'effect_kill_switch',
      }),
    );
  });

  it('claims reply and CRM effects before the ownership-changing handoff', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (callback: (manager: { query: typeof query }) => unknown) =>
          Promise.resolve(callback({ query })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(worker.processOnce('worker-test')).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHEN 'ensure_contact' THEN 0[\s\S]*WHEN 'ensure_opportunity' THEN 1[\s\S]*WHEN 'reply' THEN 2[\s\S]*WHEN 'handoff' THEN 4[\s\S]*ELSE 3/,
      ),
    );
  });
});
