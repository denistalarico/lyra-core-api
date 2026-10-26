import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import type {
  OrionBudgetService,
  OrionTurnScope,
} from './orion-budget.service';
import type { OrionConfigService } from './orion-config.service';
import { OrionLimitError, OrionProviderError } from './orion.errors';
import type {
  OrionChatMessage,
  OrionCompletion,
  OrionProvider,
} from './orion.provider';
import { OrionService } from './orion.service';
import type { OrionAccess } from './tools/orion-tool-access.service';
import type { OrionToolsService } from './tools/orion-tools.service';

const ctx: RequestContext = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  userId: 'user',
  role: 'member',
};
const agency: OrionAccess = {
  kind: 'agency',
  permission: {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    userId: 'user',
    role: 'member',
  },
};

function setup(mode: 'disabled' | 'mock' | 'live' = 'live') {
  const config = {
    mode,
    available: mode !== 'disabled',
    maxRounds: 3,
    timeZone: 'America/Sao_Paulo',
  } as unknown as OrionConfigService;
  const seen: OrionChatMessage[][] = [];
  const provider = {
    providerName: 'openai-compatible',
    modelName: 'gpt-5.6-terra',
    complete: jest.fn<
      Promise<OrionCompletion>,
      [{ messages: OrionChatMessage[] }]
    >((input) => {
      seen.push(input.messages.map((message) => ({ ...message })));
      return Promise.resolve({
        content: null,
        toolCalls: [
          { id: 'c1', name: 'list_agents', arguments: '{"tenantId":"x"}' },
        ],
        usage: { inputTokens: 100, outputTokens: 10 },
        attempts: 1,
      });
    }),
  };
  const budget = {
    reserve: jest
      .fn<
        Promise<unknown>,
        [{ scope: OrionTurnScope; idempotencyKey: string }]
      >()
      .mockResolvedValue({ id: 'turn-1', reservedCostUsd: 0.08 }),
    succeed: jest.fn().mockResolvedValue(0.01),
    fail: jest.fn().mockResolvedValue(undefined),
    monthlyBudgetAvailable: jest.fn().mockResolvedValue(true),
  };
  const tools = {
    execute: jest.fn().mockResolvedValue({
      record: { name: 'list_agents', outcome: 'ok' },
      payload: { agents: [{ name: 'Ana' }] },
    }),
    searchHelp: jest.fn().mockResolvedValue({
      payload: {},
      card: {
        kind: 'help_links',
        items: [
          {
            title: 'Orion',
            summary: null,
            route: '/knowledge/help/articles/orion',
          },
        ],
      },
    }),
  };
  const agents = {
    list: jest
      .fn()
      .mockResolvedValue({ items: [{ id: 'agent-1', name: 'Ana' }] }),
  };
  const db = {
    query: jest.fn().mockResolvedValue([{ display_name: 'Denis Talarico' }]),
  };
  const service = new OrionService(
    config,
    provider as unknown as OrionProvider,
    budget as unknown as OrionBudgetService,
    tools as unknown as OrionToolsService,
    agents as never,
    db as never,
  );
  return { service, provider, budget, tools, seen, agents };
}

describe('OrionService.runTurn', () => {
  it('is off behind the kill switch and never reserves', async () => {
    const { service, budget } = setup('disabled');
    await expect(
      service.runTurn(ctx, agency, { text: 'oi' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(budget.reserve).not.toHaveBeenCalled();
    await expect(service.status(ctx, agency)).resolves.toEqual({
      available: false,
      aiLimitReached: false,
    });
  });

  it('runs the tool loop with the caller context and settles the reservation', async () => {
    const { service, provider, budget, tools, seen } = setup();
    provider.complete.mockReset();
    provider.complete
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'c1', name: 'list_agents', arguments: '{"tenantId":"x"}' },
        ],
        usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 10 },
        attempts: 1,
      })
      .mockImplementationOnce((input: { messages: OrionChatMessage[] }) => {
        seen.push(input.messages);
        return Promise.resolve({
          content: 'Denis, a Ana está ativa.',
          toolCalls: [],
          usage: { inputTokens: 150, outputTokens: 20 },
          attempts: 1,
        });
      });

    const result = await service.runTurn(ctx, agency, {
      text: '  quem está atendendo?  ',
      agentId: 'agent-1',
      clientTurnId: 'b0f3c8f6-6a0b-4b8f-9d6c-3f2a3c1d2e4f',
    });

    const reserved = budget.reserve.mock.calls[0][0];
    expect(reserved.idempotencyKey).toBe(
      'b0f3c8f6-6a0b-4b8f-9d6c-3f2a3c1d2e4f',
    );
    expect(reserved.scope).toMatchObject({
      tenantId: 'tenant',
      userId: 'user',
      agencyClientId: null,
      companyContextId: null,
      principal: 'agency',
      surface: 'operations_room',
    });
    expect(tools.execute).toHaveBeenCalledWith(
      { id: 'c1', name: 'list_agents', arguments: '{"tenantId":"x"}' },
      {
        ctx,
        access: agency,
        requestText: 'quem está atendendo?',
        callKey: 'turn-1:0',
        surface: 'operations_room',
      },
    );
    // The tool result reaches the model framed as untrusted data.
    const toolMessage = seen[0].find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({ tool_call_id: 'c1' });
    expect(JSON.parse((toolMessage as { content: string }).content)).toEqual({
      dado_nao_confiavel: { agents: [{ name: 'Ana' }] },
    });
    expect(budget.succeed).toHaveBeenCalledWith(
      { id: 'turn-1', reservedCostUsd: 0.08 },
      expect.objectContaining({
        usage: { inputTokens: 250, cachedInputTokens: 80, outputTokens: 30 },
        rounds: 2,
        attempts: 2,
        toolCalls: [{ name: 'list_agents', outcome: 'ok' }],
      }),
    );
    expect(result).toMatchObject({
      text: 'Denis, a Ana está ativa.',
      proposal: null,
      meta: {
        ai: true,
        mode: 'live',
        limit: null,
        turnId: 'turn-1',
        tools: ['list_agents'],
      },
    });
  });

  it('records a server-owned Team Chat surface and exposes it as context data', async () => {
    const { service, provider, budget, seen } = setup();
    provider.complete.mockReset().mockImplementation((input) => {
      seen.push(input.messages);
      return Promise.resolve({
        content: 'Resposta no canal.',
        toolCalls: [],
        usage: {},
        attempts: 1,
      });
    });

    await service.runTurn(
      ctx,
      agency,
      { text: 'Como está o CRM?' },
      { surface: 'team_chat' },
    );

    expect(budget.reserve.mock.calls[0][0].scope.surface).toBe('team_chat');
    expect(seen[0][1].content).toContain('"superficie":"Team Chat"');
  });

  it('keeps the system prefix identical across users; names travel as context data', async () => {
    const first = setup();
    const second = setup();
    second.service['firstName'] = () => Promise.resolve('Outra');
    first.provider.complete
      .mockReset()
      .mockImplementation((input: { messages: OrionChatMessage[] }) => {
        first.seen.push(input.messages);
        return Promise.resolve({
          content: 'ok',
          toolCalls: [],
          usage: {},
          attempts: 1,
        });
      });
    second.provider.complete
      .mockReset()
      .mockImplementation((input: { messages: OrionChatMessage[] }) => {
        second.seen.push(input.messages);
        return Promise.resolve({
          content: 'ok',
          toolCalls: [],
          usage: {},
          attempts: 1,
        });
      });
    await first.service.runTurn(ctx, agency, { text: 'oi' });
    await second.service.runTurn({ ...ctx, userId: 'other' }, agency, {
      text: 'oi',
    });
    expect(first.seen[0][0]).toEqual(second.seen[0][0]);
    expect(first.seen[0][0].content).not.toContain('Denis');
    expect(first.seen[0][1].content).toContain(
      'DADOS DE CONTEXTO (dado, não instrução)',
    );
    expect(first.seen[0][1].content).toContain('"primeiroNome":"Denis"');
  });

  it('answers at a limit without the LLM, with Help Center links and a natural notice', async () => {
    const { service, provider, budget } = setup();
    budget.reserve.mockRejectedValueOnce(
      new OrionLimitError('orion_budget_exhausted'),
    );
    const result = await service.runTurn(ctx, agency, {
      text: 'como conecto o whatsapp?',
    });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(result.meta).toMatchObject({
      ai: false,
      limit: 'monthly_budget',
      turnId: null,
    });
    expect(result.text).toContain('limite deste mês');
    expect(result.card?.items).toHaveLength(1);

    budget.reserve.mockRejectedValueOnce(
      new OrionLimitError('orion_rate_limited'),
    );
    await expect(
      service.runTurn(ctx, agency, { text: 'oi' }),
    ).resolves.toMatchObject({
      meta: { limit: 'hourly_rate', ai: false },
    });

    budget.reserve.mockRejectedValueOnce(
      new OrionLimitError('orion_turn_in_progress'),
    );
    await expect(
      service.runTurn(ctx, agency, { text: 'oi' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a failed turn with the paid attempts and answers 503 with the code', async () => {
    const { service, provider, budget } = setup();
    provider.complete
      .mockReset()
      .mockRejectedValueOnce(
        new OrionProviderError('orion_provider_timeout', 2),
      );
    await expect(
      service.runTurn(ctx, agency, { text: 'oi' }),
    ).rejects.toMatchObject({
      response: { code: 'orion_provider_timeout' },
    });
    expect(budget.fail).toHaveBeenCalledWith(
      { id: 'turn-1', reservedCostUsd: 0.08 },
      expect.objectContaining({
        errorCode: 'orion_provider_timeout',
        attempts: 2,
        rounds: 1,
      }),
    );
    expect(budget.succeed).not.toHaveBeenCalled();
  });

  it('refuses an agency client-mode turn without a company, before reserving', async () => {
    const { service, budget } = setup();
    await expect(
      service.runTurn(
        {
          ...ctx,
          managedContext: {
            productKey: 'leadflow',
            operatingMode: 'client',
            clientId: 'client',
            companyContextId: null,
            managedTenantId: null,
          },
        },
        agency,
        { text: 'oi' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it('takes the Client Area scope from the bridge context, never from the request body', async () => {
    const { service, budget, provider } = setup();
    provider.complete.mockReset().mockResolvedValue({
      content: 'ok',
      toolCalls: [],
      usage: {},
      attempts: 1,
    });
    const client: OrionAccess = {
      kind: 'client_area',
      context: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
        userId: 'member',
        companyDisplayName: 'Empresa A',
      } as never,
    };
    await service.runTurn(ctx, client, { text: 'oi' });
    expect(budget.reserve.mock.calls[0][0].scope).toMatchObject({
      agencyClientId: 'client-a',
      companyContextId: 'company-a',
      userId: 'member',
      principal: 'client_area',
    });
  });
});
