import { LeadFlowWebhookDispatcherService } from './leadflow-webhook-dispatcher.service';

describe('LeadFlowWebhookDispatcherService', () => {
  const allowed = {
    evaluate: () => ({ allowed: true }),
    isEnabled: () => true,
  };

  function build(overrides: {
    subscribers?: unknown[];
    claimed?: { id: string; attempts: number } | null;
  }) {
    const update = jest.fn().mockResolvedValue(undefined);
    const insertExecute = jest
      .fn()
      .mockResolvedValue({ raw: overrides.claimed ? [{ id: 'row-1' }] : [] });
    const deliveries = {
      update,
      findOne: jest.fn().mockResolvedValue(overrides.claimed ?? null),
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: () => ({
              orIgnore: () => ({
                returning: () => ({ execute: insertExecute }),
              }),
            }),
          }),
        }),
      }),
    };
    const automations = {
      createQueryBuilder: () => {
        const builder = {
          where: () => builder,
          andWhere: () => builder,
          getMany: async () => overrides.subscribers ?? [],
        };
        return builder;
      },
    };
    const service = new LeadFlowWebhookDispatcherService(
      { query: jest.fn() } as never,
      deliveries as never,
      automations as never,
      allowed as never,
    );
    return { service, update, insertExecute, deliveries };
  }

  const event = {
    id: 'event-1',
    sourceEventId: 'source-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.crm.opportunity.won',
    eventVersion: 1,
    aggregateType: 'crm_opportunity',
    aggregateId: 'opportunity-1',
    payload: { value: 1200, currency: 'BRL' },
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
  } as never;

  const automation = {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    webhookConfig: {
      enabled: true,
      url: 'https://example.com/hook',
      method: 'POST',
      secret: 'shhh',
      events: ['leadflow.crm.opportunity.won'],
      payloadFields: { 'leadflow.crm.opportunity.won': ['value'] },
      retryPolicy: { maxRetries: 3, backoffSeconds: 30 },
    },
  };

  afterEach(() => jest.restoreAllMocks());

  it('sends the selected fields, signed, and records the delivery', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      status: 200,
      text: async () => 'ok',
    } as never);
    const { service, update } = build({
      subscribers: [automation],
      claimed: { id: 'row-1', attempts: 0 },
    });

    await service.dispatch(event);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(JSON.parse(init.body as string).data).toEqual({ value: 1200 });
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Lyra-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(headers['X-Lyra-Event']).toBe('leadflow.crm.opportunity.won');
    // Following a redirect is how an SSRF check gets bypassed after the fact.
    expect(init.redirect).toBe('error');
    expect(update).toHaveBeenCalledWith(
      { id: 'row-1' },
      expect.objectContaining({ status: 'delivered', attempts: 1 }),
    );
  });

  it('does not read the body unless the endpoint asked us to', async () => {
    const text = jest.fn().mockResolvedValue('ignored');
    jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue({ status: 202, text } as never);
    const { service } = build({
      subscribers: [automation],
      claimed: { id: 'row-1', attempts: 0 },
    });

    await service.dispatch(event);

    expect(text).not.toHaveBeenCalled();
  });

  it('schedules a retry for a server error and stops for a rejection', async () => {
    jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue({ status: 503, text: async () => '' } as never);
    const retrying = build({
      subscribers: [automation],
      claimed: { id: 'row-1', attempts: 0 },
    });
    await retrying.service.dispatch(event);
    expect(retrying.update).toHaveBeenCalledWith(
      { id: 'row-1' },
      expect.objectContaining({ status: 'retrying' }),
    );
    expect(retrying.update.mock.calls[0][1].nextAttemptAt).toBeInstanceOf(Date);

    jest
      .spyOn(global, 'fetch' as never)
      .mockResolvedValue({ status: 401, text: async () => '' } as never);
    const dead = build({
      subscribers: [automation],
      claimed: { id: 'row-1', attempts: 0 },
    });
    await dead.service.dispatch(event);
    expect(dead.update).toHaveBeenCalledWith(
      { id: 'row-1' },
      expect.objectContaining({ status: 'dead_letter', nextAttemptAt: null }),
    );
  });

  it('never posts twice for the same event and endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never);
    // The insert lost the race against the unique index: the pair already ran.
    const { service } = build({ subscribers: [automation], claimed: null });

    await service.dispatch(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a URL that points back inside the network', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never);
    const { service, update } = build({
      subscribers: [
        {
          ...automation,
          webhookConfig: {
            ...automation.webhookConfig,
            url: 'https://127.0.0.1/hook',
          },
        },
      ],
      claimed: { id: 'row-1', attempts: 0 },
    });

    await service.dispatch(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      { id: 'row-1' },
      expect.objectContaining({
        status: 'dead_letter',
        errorCode: 'webhook_url_private_network',
      }),
    );
  });

  it('sends nothing at all while the gate is closed', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as never);
    const service = new LeadFlowWebhookDispatcherService(
      { query: jest.fn() } as never,
      {} as never,
      {} as never,
      {
        evaluate: () => ({ allowed: false, reason: 'dispatch_disabled' }),
        isEnabled: () => false,
      } as never,
    );

    await service.dispatch(event);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
