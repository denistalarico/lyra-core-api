import { DataSource, type EntityManager } from 'typeorm';
import { ContractAiAssistService } from './contract-ai-assist.service';
import { ContractAiAssistConfigService } from './contract-ai-assist-config.service';
import { ContractAiAssistProvider } from './contract-ai-assist.provider';
import {
  ContractAiAssistProviderError,
  type ContractAiAssistProviderResult,
} from './contract-ai-assist.types';
import { ContractAiAssistRun } from '../entities/contract-ai-assist-run.entity';
import {
  AiCostLedgerService,
  type AiCostEntryInput,
} from '../../ai-costs/ai-cost-ledger.service';
import type { AuthorizedRequestContext } from '../../../common/context/authorized-context.decorator';

const context: AuthorizedRequestContext = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'user-a',
  role: 'admin',
  sessionId: 'session-a',
};
const dto = { sourceText: 'ACME & Cia', targetType: 'client' as const };
const response: ContractAiAssistProviderResult = {
  model: 'gpt-6.1-sol',
  paid: true,
  usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 },
  output: {
    replacements: [
      {
        originalText: 'ACME & Cia',
        variable: 'client.name',
        confidence: 'high',
      },
    ],
    headings: [],
    suggestions: {
      name: null,
      description: null,
      category: null,
      defaultSignatureMode: null,
      jurisdictionRegion: null,
      countryCode: null,
      locale: null,
    },
    reviewNotes: [],
  },
};

function harness() {
  const runs: ContractAiAssistRun[] = [];
  const entries: AiCostEntryInput[] = [];
  const repository = {
    create: (data: Partial<ContractAiAssistRun>) =>
      Object.assign(new ContractAiAssistRun(), data),
    save: jest.fn((run: ContractAiAssistRun) => {
      run.id = `run-${runs.length + 1}`;
      run.createdAt = new Date();
      runs.push(run);
      return Promise.resolve(run);
    }),
    findOneBy: jest.fn((where: Partial<ContractAiAssistRun>) =>
      Promise.resolve(runs.find((r) => matches(r, where)) ?? null),
    ),
    update: jest.fn(
      (
        where: Partial<ContractAiAssistRun>,
        patch: Partial<ContractAiAssistRun>,
      ) => {
        const found = runs.find((r) => matches(r, where));
        if (found) Object.assign(found, patch);
        return Promise.resolve({ affected: found ? 1 : 0 });
      },
    ),
  };
  const query = jest.fn((sql: string, params: string[]) =>
    Promise.resolve(
      sql.includes('count(*)')
        ? [
            {
              count: runs.filter(
                (r) => r.tenantId === params[0] && r.workspaceId === params[1],
              ).length,
            },
          ]
        : [],
    ),
  );
  const manager = {
    query,
    getRepository: () => repository,
  } as unknown as EntityManager;
  const transaction = jest.fn(
    async (work: (m: EntityManager) => Promise<unknown>) => {
      const beforeRuns = runs.map((r) => ({ ...r }));
      const beforeEntries = [...entries];
      try {
        return await work(manager);
      } catch (error) {
        runs.splice(0, runs.length, ...(beforeRuns as ContractAiAssistRun[]));
        entries.splice(0, entries.length, ...beforeEntries);
        throw error;
      }
    },
  );
  const generate = jest
    .fn<Promise<ContractAiAssistProviderResult>, [typeof dto, string]>()
    .mockResolvedValue(response);
  const record = jest.fn(
    (items: readonly AiCostEntryInput[], m?: EntityManager) => {
      expect(m).toBe(manager);
      entries.push(...items);
      return Promise.resolve({ inserted: items.length, upgraded: 0 });
    },
  );
  const config = new ContractAiAssistConfigService();
  const service = new ContractAiAssistService(
    { transaction } as unknown as DataSource,
    config,
    { generate } as unknown as ContractAiAssistProvider,
    { record } as unknown as AiCostLedgerService,
  );
  return {
    service,
    config,
    runs,
    entries,
    generate,
    record,
    query,
    transaction,
    repository,
  };
}

function matches(
  row: ContractAiAssistRun,
  where: Partial<ContractAiAssistRun>,
): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

describe('ContractAiAssistService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      CONTRACT_AI_ASSIST_PROVIDER_MODE: 'live',
      CONTRACT_AI_ASSIST_PROVIDER_API_KEY: 'test-only',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a sanitized result and atomically records unknown/unpriced internal agency cost', async () => {
    const h = harness();
    const result = await h.service.assist(context, dto, 'key');
    expect(result.bodyHtml).toBe('<p>{{client.name}}</p>');
    expect(h.runs[0].status).toBe('succeeded');
    expect(h.runs[0].inputChars).toBe(dto.sourceText.length);
    expect(h.runs[0].inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(h.entries[0]).toMatchObject({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      sourceDomain: 'agency.contracts',
      sourceType: 'template_ai_assist_run',
      sourceId: result.runId,
      logicalType: 'contract_template_ai_assist',
      logicalId: result.runId,
      operationKind: 'variable_mapping',
      provider: 'openai',
      agencyClientId: null,
      companyContextId: null,
      cost: { status: 'unknown', reason: 'unpriced' },
      outcome: 'succeeded',
      usage: {
        unit: 'tokens',
        quantity: '130',
        metrics: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 30,
        },
      },
    });
    expect(JSON.stringify(h.entries[0].metadata)).not.toContain('ACME');
    expect(Object.keys(h.runs[0])).not.toContain('sourceText');
    expect(h.generate).toHaveBeenCalledWith(dto, result.runId);
  });

  it('replays exactly without a second provider call, cost row or daily reservation', async () => {
    const h = harness();
    const first = await h.service.assist(context, dto, 'key');
    const replay = await h.service.assist(context, dto, 'key');
    expect(replay).toEqual(first);
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.entries).toHaveLength(1);
    expect(h.runs).toHaveLength(1);
  });

  it('rejects key reuse when source, source type or categories change', async () => {
    const h = harness();
    await h.service.assist(context, dto, 'key');
    for (const changed of [
      { ...dto, sourceText: 'Changed' },
      { sourceHtml: dto.sourceText, targetType: 'client' as const },
      { ...dto, categoryOptions: [{ value: 'id', label: 'Category' }] },
    ])
      await expect(
        h.service.assist(context, changed, 'key'),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'idempotency_key_reused' },
      });
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('isolates replay and daily accounting by both tenant and workspace', async () => {
    const h = harness();
    for (const scope of [
      context,
      { ...context, tenantId: 'tenant-b' },
      { ...context, workspaceId: 'workspace-b' },
    ])
      await h.service.assist(scope, dto, 'key');
    expect(h.runs).toHaveLength(3);
    expect(new Set(h.generate.mock.calls.map((c) => c[1])).size).toBe(3);
  });

  it('rejects a processing replay with 409 without another paid call', async () => {
    const h = harness();
    await h.service.assist(context, dto, 'key');
    h.runs[0].status = 'processing';
    h.runs[0].result = null;
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 409,
      response: { code: 'contract_ai_run_in_progress' },
    });
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('reserves in-flight work before provider I/O, blocking replay and a second run at the daily limit', async () => {
    process.env.CONTRACT_AI_ASSIST_DAILY_LIMIT_PER_WORKSPACE = '1';
    const h = harness();
    let releaseProvider: (
      value: ContractAiAssistProviderResult,
    ) => void = () => {
      throw new Error('provider_not_started');
    };
    let notifyStarted: () => void = () => {
      throw new Error('start_not_initialized');
    };
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    h.generate.mockImplementationOnce(() => {
      notifyStarted();
      return new Promise((resolve) => {
        releaseProvider = resolve;
      });
    });
    const first = h.service.assist(context, dto, 'key');
    await started;
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      h.service.assist(context, dto, 'another-key'),
    ).rejects.toMatchObject({ status: 429 });
    expect(h.generate).toHaveBeenCalledTimes(1);
    releaseProvider(response);
    await expect(first).resolves.toHaveProperty('runId');
  });

  it('checks the daily limit under a scope lock and permits successful replay at the limit', async () => {
    process.env.CONTRACT_AI_ASSIST_DAILY_LIMIT_PER_WORKSPACE = '1';
    const h = harness();
    await h.service.assist(context, dto, 'key');
    await expect(h.service.assist(context, dto, 'other')).rejects.toMatchObject(
      { status: 429, response: { code: 'contract_ai_daily_limit' } },
    );
    await expect(h.service.assist(context, dto, 'key')).resolves.toHaveProperty(
      'runId',
    );
    expect(h.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(h.query.mock.calls[0][1]).toEqual([
      'contract_ai_assist:tenant-a:workspace-a',
    ]);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('records usage and failed cost after a paid invalid response, and never calls again on replay', async () => {
    const h = harness();
    h.generate.mockRejectedValue(
      new ContractAiAssistProviderError('invalid_response', true, {
        inputTokens: 50,
        outputTokens: 15,
      }),
    );
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 502,
      response: { code: 'contract_ai_provider_failed' },
    });
    expect(h.runs[0]).toMatchObject({
      status: 'failed',
      result: null,
      usage: { inputTokens: 50, outputTokens: 15 },
    });
    expect(h.entries[0]).toMatchObject({
      outcome: 'failed',
      cost: { status: 'unknown', reason: 'unpriced' },
      usage: { metrics: { input_tokens: 50, output_tokens: 15 } },
    });
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 502,
    });
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate a paid cost for a rejected request or mock operation', async () => {
    const h = harness();
    h.generate.mockRejectedValueOnce(
      new ContractAiAssistProviderError('request_rejected'),
    );
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 502,
    });
    h.generate.mockResolvedValueOnce({ ...response, paid: false, usage: {} });
    const result = await h.service.assist(context, dto, 'mock-key');
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
    expect(h.entries).toHaveLength(0);
  });

  it('rolls back closure when ledger storage fails, leaving replay in progress instead of charging again', async () => {
    const h = harness();
    h.record.mockRejectedValue(new Error('storage failure'));
    await expect(h.service.assist(context, dto, 'key')).rejects.toThrow(
      'storage failure',
    );
    expect(h.runs[0].status).toBe('processing');
    expect(h.entries).toHaveLength(0);
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 409,
    });
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it('does not write a ledger entry if closure did not update the reserved run', async () => {
    const h = harness();
    h.repository.update.mockResolvedValue({ affected: 0 });
    await expect(h.service.assist(context, dto, 'key')).rejects.toThrow(
      'contract_ai_run_closure_failed',
    );
    expect(h.entries).toHaveLength(0);
    expect(h.runs[0].status).toBe('processing');
  });

  it('rejects disabled mode without reserving or calling the provider', async () => {
    process.env.CONTRACT_AI_ASSIST_PROVIDER_MODE = 'disabled';
    const h = harness();
    await expect(h.service.assist(context, dto, 'key')).rejects.toMatchObject({
      status: 503,
      response: { code: 'contract_ai_disabled' },
    });
    expect(h.runs).toHaveLength(0);
    expect(h.generate).not.toHaveBeenCalled();
  });

  it('validates empty, exclusive, large input and the mandatory bounded header before reservation', async () => {
    const h = harness();
    for (const key of [undefined, '', ' ', 'x'.repeat(121)])
      await expect(h.service.assist(context, dto, key)).rejects.toMatchObject({
        status: 400,
      });
    for (const invalid of [
      { targetType: 'client' as const },
      { ...dto, sourceText: ' ' },
      { ...dto, sourceHtml: '<p>test</p>' },
      { sourceHtml: '<script>hidden</script>', targetType: 'client' as const },
    ])
      await expect(
        h.service.assist(context, invalid, 'key'),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'contract_ai_input_empty' },
      });
    await expect(
      h.service.assist(
        context,
        { ...dto, sourceText: 'x'.repeat(80001) },
        'key',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'contract_ai_input_too_large' },
    });
    expect(h.transaction).not.toHaveBeenCalled();
  });
});
