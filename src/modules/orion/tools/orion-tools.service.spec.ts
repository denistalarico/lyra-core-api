import type { RequestContext } from '../../../common/context/request-context.interface';
import type { OrionConfigService } from '../orion-config.service';
import type {
  OrionToolAccessService,
  OrionAccess,
} from './orion-tool-access.service';
import { OrionToolsService } from './orion-tools.service';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ctx: RequestContext = {
  tenantId: 'tenant-from-jwt',
  workspaceId: 'workspace-from-jwt',
  userId: 'user-from-jwt',
};
const agency: OrionAccess = {
  kind: 'agency',
  permission: {
    tenantId: 'tenant-from-jwt',
    userId: 'user-from-jwt',
    role: 'member',
  },
};
const client = { kind: 'client_area', context: {} } as OrionAccess;

function setup(allowed = true) {
  const access = { allowed: jest.fn().mockResolvedValue(allowed) };
  const help = {
    search: jest.fn().mockResolvedValue([
      {
        slug: 'conectar-whatsapp',
        title: 'Conectar o WhatsApp',
        summary: 'Passo a passo',
        excerpt: 'Abra Canais',
      },
    ]),
  };
  const operational = {
    getOverview: jest.fn().mockResolvedValue({
      messages: {
        summary: {
          total: 10,
          inbound: 6,
          outbound: 4,
          automatedOutbound: 3,
          humanOutbound: 1,
          failedOutbound: 0,
          conversations: 5,
          respondedConversations: 5,
          firstResponseRate: 1,
          averageFirstResponseSeconds: 30,
          averageResponseSeconds: 40,
        },
        byChannel: [
          {
            channelId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
            name: 'WhatsApp',
            type: 'whatsapp',
            inbound: 6,
            outbound: 4,
            conversations: 5,
            averageResponseSeconds: 40,
          },
        ],
        byAgent: [
          {
            agentId: '1b4e28ba-2fa1-11d2-883f-0016d3cca428',
            name: 'Ana',
            outbound: 4,
            conversations: 5,
            averageResponseSeconds: 40,
            leadRepliesAfterFirstReply: 2,
          },
        ],
      },
      leadScore: {
        summary: { opportunities: 2, averageScore: 50, hotTransitions: 1 },
      },
    }),
  };
  const agents = {
    list: jest.fn().mockResolvedValue({
      items: [
        {
          id: '1b4e28ba-2fa1-11d2-883f-0016d3cca429',
          name: 'Ana',
          type: 'sdr',
          status: 'active',
          archivedAt: null,
          deletedAt: null,
          channels: [{ channelKey: 'whatsapp' }, { channelKey: 'whatsapp' }],
        },
        {
          id: 'x',
          name: 'Removido',
          type: 'sdr',
          status: 'paused',
          archivedAt: null,
          deletedAt: '2026-01-01',
          channels: [],
        },
      ],
    }),
  };
  const agenda = {
    listAppointments: jest.fn().mockResolvedValue([
      {
        startAt: new Date(Date.now() + 60_000),
        dueAt: null,
        allDay: false,
        title: 'Reunião com Maria',
        type: 'meeting',
        status: 'scheduled',
      },
      {
        startAt: new Date(Date.now() + 10 * 86_400_000),
        dueAt: null,
        allDay: false,
        title: 'Daqui a dez dias',
        type: 'call',
        status: 'scheduled',
      },
    ]),
    listItems: jest.fn(),
  };
  const crm = {
    listPipelines: jest
      .fn()
      .mockResolvedValue([{ id: 'p', name: 'Vendas', sortOrder: 1 }]),
    listStages: jest.fn().mockResolvedValue([
      { id: 's1', pipelineId: 'p', name: 'Novo', sortOrder: 1 },
      { id: 's2', pipelineId: 'p', name: 'Proposta', sortOrder: 2 },
    ]),
    listOpportunities: jest
      .fn()
      .mockResolvedValue([
        { stageId: 's1' },
        { stageId: 's1' },
        { stageId: 's2' },
      ]),
  };
  const proposals = {
    propose: jest.fn().mockResolvedValue({
      payload: { proposal: { title: 'Pausar agente' } },
      proposal: { id: 'p1', title: 'Pausar agente' },
    }),
  };
  const service = new OrionToolsService(
    access as unknown as OrionToolAccessService,
    help as never,
    operational as never,
    { getCommercialJourney: jest.fn() } as never,
    agents as never,
    crm as never,
    agenda as never,
    { timeZone: 'America/Sao_Paulo' } as OrionConfigService,
    proposals as never,
  );
  return { service, access, help, operational, agents, agenda, crm, proposals };
}

const call = (name: string, args: unknown) => ({
  id: 'c1',
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
});

describe('OrionToolsService', () => {
  it('rejects unknown tools and invalid arguments before any permission or service', async () => {
    const { service, access, operational } = setup();
    await expect(
      service.execute(call('drop_tables', {}), { ctx, access: agency }),
    ).resolves.toMatchObject({
      record: { name: 'unknown', outcome: 'invalid' },
    });
    for (const args of [
      '{not json',
      { period: 'forever' },
      [],
      { day: 'today' },
    ])
      await expect(
        service.execute(call('leadflow_operational_overview', args), {
          ctx,
          access: agency,
        }),
      ).resolves.toMatchObject({
        record: { outcome: 'invalid' },
        payload: { error: 'invalid_arguments' },
      });
    expect(access.allowed).not.toHaveBeenCalled();
    expect(operational.getOverview).not.toHaveBeenCalled();
  });

  it('denies without calling the service when the caller lacks the permission', async () => {
    const { service, operational } = setup(false);
    await expect(
      service.execute(
        call('leadflow_operational_overview', { period: 'today' }),
        { ctx, access: agency },
      ),
    ).resolves.toEqual({
      record: { name: 'leadflow_operational_overview', outcome: 'denied' },
      payload: { error: 'permission_denied' },
    });
    expect(operational.getOverview).not.toHaveBeenCalled();
  });

  it('ignores scope arguments from the model: the service receives the JWT context only', async () => {
    const { service, operational, access } = setup();
    const result = await service.execute(
      call('leadflow_operational_overview', {
        period: 'last_7_days',
        tenantId: 'other-tenant',
        companyContextId: 'other-company',
        agentId: 'other-agent',
      }),
      { ctx, access: agency },
    );
    expect(access.allowed).toHaveBeenCalledWith(agency, expect.anything());
    expect(operational.getOverview).toHaveBeenCalledTimes(1);
    const [usedCtx, query] = operational.getOverview.mock.calls[0] as [
      RequestContext,
      Record<string, unknown>,
    ];
    expect(usedCtx).toBe(ctx);
    expect(Object.keys(query).sort()).toEqual(['from', 'to']);
    expect(result.record.outcome).toBe('ok');
    // Aggregates and display names only: no internal ids reach the model.
    expect(JSON.stringify(result.payload)).not.toMatch(UUID);
  });

  it('summarizes agents, the CRM funnel and the day agenda without ids', async () => {
    const { service, agenda } = setup();
    const agents = await service.execute(call('list_agents', {}), {
      ctx,
      access: client,
    });
    expect(agents.payload).toEqual({
      agents: [
        {
          name: 'Ana',
          type: 'sdr',
          status: 'active',
          archived: false,
          channels: ['whatsapp'],
        },
      ],
    });
    const crm = await service.execute(call('crm_pipeline_snapshot', {}), {
      ctx,
      access: agency,
    });
    expect(crm.payload).toEqual({
      openOpportunities: 3,
      pipelines: [
        {
          pipeline: 'Vendas',
          stages: [
            { stage: 'Novo', open: 2 },
            { stage: 'Proposta', open: 1 },
          ],
        },
      ],
    });
    const day = await service.execute(
      call('agenda_for_day', { day: 'today' }),
      { ctx, access: client },
    );
    expect(agenda.listItems).not.toHaveBeenCalled();
    expect(
      (day.payload as { items: unknown[] }).items.length,
    ).toBeLessThanOrEqual(1);
    expect(
      JSON.stringify([agents.payload, crm.payload, day.payload]),
    ).not.toMatch(UUID);
  });

  it('links help articles for the Agency only and builds the card', async () => {
    const { service } = setup();
    const agencyHit = await service.execute(
      call('search_help', { query: 'whatsapp' }),
      { ctx, access: agency },
    );
    expect(agencyHit.card?.items[0].route).toBe(
      '/knowledge/help/articles/conectar-whatsapp',
    );
    const clientHit = await service.execute(
      call('search_help', { query: 'whatsapp' }),
      { ctx, access: client },
    );
    expect(clientHit.card?.items[0].route).toBeNull();
  });

  it('OR7: the client chat gets no Agency link, no UI action and no proposal, whoever mentioned', async () => {
    const { service, access, proposals } = setup();
    const chatAgency: OrionAccess = {
      ...agency,
      clientVisible: { modules: {} as never },
    } as OrionAccess;
    const hit = await service.execute(
      call('search_help', { query: 'whatsapp' }),
      { ctx, access: chatAgency, surface: 'client_chat' },
    );
    expect(hit.card?.items[0].route).toBeNull();
    for (const who of [chatAgency, client]) {
      for (const [name, args] of [
        ['ui_action', { action: 'set_theme', value: 'dark' }],
        ['propose_action', { intent: 'pause_agent', agent: 'Ana' }],
      ] as const) {
        const result = await service.execute(call(name, args), {
          ctx,
          access: who,
          surface: 'client_chat',
        });
        expect(result.record).toEqual({ name: 'unknown', outcome: 'invalid' });
      }
    }
    expect(access.allowed).not.toHaveBeenCalled();
    expect(proposals.propose).not.toHaveBeenCalled();
  });

  it('allows only allowlisted UI actions; the client never navigates to Agency screens', async () => {
    const { service } = setup();
    const theme = await service.execute(
      call('ui_action', { action: 'set_theme', value: 'dark' }),
      { ctx, access: client },
    );
    expect(theme.uiAction).toEqual({ action: 'set_theme', value: 'dark' });
    const go = await service.execute(
      call('ui_action', { action: 'navigate', value: '/leadflow/crm' }),
      { ctx, access: agency },
    );
    expect(go.uiAction).toEqual({ action: 'navigate', value: '/leadflow/crm' });
    for (const [args, access] of [
      [{ action: 'navigate', value: 'https://evil.example' }, agency],
      [{ action: 'navigate', value: '/finance/payments' }, agency],
      [{ action: 'navigate', value: '/leadflow/crm' }, client],
      [{ action: 'set_theme', value: 'neon' }, agency],
    ] as const) {
      const result = await service.execute(call('ui_action', args), {
        ctx,
        access,
      });
      expect(result.record.outcome).toBe('invalid');
      expect(result.uiAction).toBeUndefined();
    }
  });

  it('turns a service failure into an opaque error for the model', async () => {
    const { service, agents } = setup();
    agents.list.mockRejectedValueOnce(
      new Error('company context required for Maria'),
    );
    await expect(
      service.execute(call('list_agents', {}), { ctx, access: agency }),
    ).resolves.toEqual({
      record: { name: 'list_agents', outcome: 'error' },
      payload: { error: 'unavailable' },
    });
  });

  describe('OR5 propose_action', () => {
    it('needs the room proposal route and a known intent; passes the turn text and call key', async () => {
      const denied = setup(false);
      await expect(
        denied.service.execute(
          call('propose_action', { intent: 'pause_agent', agent: 'Ana' }),
          { ctx, access: agency },
        ),
      ).resolves.toMatchObject({ record: { outcome: 'denied' } });
      expect(denied.proposals.propose).not.toHaveBeenCalled();
      const [, requirement] = denied.access.allowed.mock.calls[0];
      expect(requirement.agency).toMatchObject({
        method: 'POST',
        routePath: '/leadflow/agents/room/actions',
      });

      const { service, proposals } = setup();
      await expect(
        service.execute(call('propose_action', { intent: 'delete_tenant' }), {
          ctx,
          access: agency,
        }),
      ).resolves.toMatchObject({ record: { outcome: 'invalid' } });
      const ok = await service.execute(
        call('propose_action', {
          intent: 'pause_agent',
          agent: 'Ana',
          tenantId: 'evil',
        }),
        { ctx, access: client, requestText: 'pausa a Ana', callKey: 'turn:0' },
      );
      expect(ok.record.outcome).toBe('ok');
      expect(ok.proposal).toMatchObject({ id: 'p1' });
      // Team Chat (OR6) has no confirmation card: no proposal there.
      await expect(
        service.execute(call('propose_action', { intent: 'pause_agent' }), {
          ctx,
          access: agency,
          surface: 'team_chat',
        }),
      ).resolves.toMatchObject({
        payload: { error: 'proposals_only_in_operations_room' },
      });
      expect(proposals.propose).toHaveBeenCalledTimes(1);
      expect(proposals.propose).toHaveBeenCalledWith(
        'pause_agent',
        expect.anything(),
        {
          ctx,
          access: client,
          requestText: 'pausa a Ana',
          idempotencyKey: 'orion:turn:0',
        },
      );
    });
  });
});
