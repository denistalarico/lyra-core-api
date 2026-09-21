/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method --
 * These assertions read the arguments the worker passed to mocked repository
 * calls, which Jest types as `any`. Narrowing each one would obscure what is
 * being checked: the exact status, lease and cost the worker writes.
 */
import type { DataSource } from 'typeorm';
import { SocialCopyGenerationRunEntity, SocialPlanEntity } from '../entities';
import type { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import type { SocialCopyGenerationProvider } from './social-copy-generation-provider';
import type {
  ResolvedGenerationWork,
  SocialCopyGenerationService,
} from './social-copy-generation.service';
import { SocialCopyGenerationWorker } from './social-copy-generation.worker';

const RUN_ID = '77777777-7777-4777-8777-777777777777';
const CONTENT_ID = '55555555-5555-4555-8555-555555555555';

function buildRun(
  overrides: Partial<SocialCopyGenerationRunEntity> = {},
): SocialCopyGenerationRunEntity {
  return {
    id: RUN_ID,
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    agencyClientId: null,
    planId: '44444444-4444-4444-8444-444444444444',
    contentItemId: CONTENT_ID,
    runKind: 'content_copy',
    idempotencyKey: 'planner-copy:content:1',
    status: 'processing',
    attempts: 1,
    maxAttempts: 3,
    requestedFields: null,
    instruction: null,
    ...overrides,
  } as SocialCopyGenerationRunEntity;
}

function buildWork(
  run: SocialCopyGenerationRunEntity,
  overrides: Partial<ResolvedGenerationWork> = {},
): ResolvedGenerationWork {
  return {
    run,
    context: 'Tema: prova social',
    contextVersion: 'planner-context-v1',
    fields: [{ field: 'caption', currentValue: 'legenda atual' }],
    instruction: null,
    format: 'image',
    longFormCaption: false,
    ...overrides,
  };
}

describe('SocialCopyGenerationWorker', () => {
  let runsRepository: {
    findOneBy: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
  };
  let transactionRepository: { findOne: jest.Mock; save: jest.Mock };
  let plansRepository: { findOne: jest.Mock };
  let claimQuery: jest.Mock;
  let claimUpdate: jest.Mock;
  let dataSource: DataSource;
  let generationService: {
    dailyBudgetRemaining: jest.Mock;
    resolveWork: jest.Mock;
    recordProposals: jest.Mock;
  };
  let provider: { generate: jest.Mock };
  let config: SocialCopyGenerationConfigService;
  let worker: SocialCopyGenerationWorker;

  function build(mode: 'disabled' | 'mock' | 'live' = 'live') {
    config = {
      mode,
      reserveCents: 5,
      inputCentsPerMillionTokens: 125,
      outputCentsPerMillionTokens: 1_000,
    } as unknown as SocialCopyGenerationConfigService;

    worker = new SocialCopyGenerationWorker(
      dataSource,
      generationService as unknown as SocialCopyGenerationService,
      provider as unknown as SocialCopyGenerationProvider,
      config,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    runsRepository = {
      findOneBy: jest.fn(() => Promise.resolve(null)),
      findOne: jest.fn(() => Promise.resolve(null)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };

    transactionRepository = {
      findOne: jest.fn(() => Promise.resolve(null)),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    plansRepository = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: '44444444-4444-4444-8444-444444444444',
          companyContextId: null,
        }),
      ),
    };

    /**
     * The claim runs raw SQL and a query-builder update on the transaction
     * manager, so the mock manager has to offer both alongside `getRepository`.
     */
    claimQuery = jest.fn(() => Promise.resolve([]));

    const updateBuilder = {
      update: jest.fn(() => updateBuilder),
      set: jest.fn(() => updateBuilder),
      whereInIds: jest.fn(() => updateBuilder),
      execute: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    claimUpdate = updateBuilder.set as jest.Mock;

    dataSource = {
      getRepository: jest.fn((entity: unknown) =>
        entity === SocialPlanEntity ? plansRepository : runsRepository,
      ),
      transaction: jest.fn(async (callback: (manager: unknown) => unknown) =>
        callback({
          getRepository: () => transactionRepository,
          query: claimQuery,
          createQueryBuilder: () => updateBuilder,
        }),
      ),
      query: claimQuery,
      createQueryBuilder: jest.fn(),
    } as unknown as DataSource;

    generationService = {
      dailyBudgetRemaining: jest.fn(() => Promise.resolve(500)),
      resolveWork: jest.fn(),
      recordProposals: jest.fn(() => Promise.resolve()),
    };

    provider = { generate: jest.fn() };

    build();
  });

  it('does not tick at all while the provider is disabled', async () => {
    build('disabled');

    await worker.tick();

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  /**
   * The re-fetch by `{id, status, lockedBy}` is what makes cancellation work: a
   * run that was cancelled between the claim and the execution must never reach
   * the provider.
   */
  it('skips a run that is no longer held by this worker', async () => {
    runsRepository.findOneBy.mockResolvedValue(null);

    await worker.processPending(1);

    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('stages proposals and records full provenance on success', async () => {
    const run = buildRun();
    runsRepository.findOneBy.mockResolvedValue(run);
    generationService.resolveWork.mockResolvedValue(buildWork(run));
    transactionRepository.findOne.mockResolvedValue(buildRun());

    provider.generate.mockResolvedValue({
      proposals: [
        {
          field: 'caption',
          value: 'legenda gerada',
          rationale: 'Mais direta.',
        },
      ],
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-copy-v1',
      usage: { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 },
      latencyMs: 1_234,
      attempts: 1,
    });

    (dataSource.query as jest.Mock).mockResolvedValue([{ id: RUN_ID }]);

    await worker['processOne'](RUN_ID);

    expect(generationService.recordProposals).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: RUN_ID }),
      [
        {
          field: 'caption',
          value: 'legenda gerada',
          baseValue: 'legenda atual',
          rationale: 'Mais direta.',
        },
      ],
    );

    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        provider: 'openai-compatible',
        model: 'gpt-test',
        promptVersion: 'planner-copy-v1',
        contextVersion: 'planner-context-v1',
        inputTokens: 1_000_000,
        latencyMs: 1_234,
        costIsEstimated: true,
        lockedBy: null,
      }),
    );
  });

  /**
   * The single most important rule in this worker. The provider call cannot be
   * recalled, but its output must not appear as a pending proposal for a run the
   * operator cancelled.
   */
  it('discards the result when the run was cancelled mid-flight', async () => {
    const run = buildRun();
    runsRepository.findOneBy.mockResolvedValue(run);
    generationService.resolveWork.mockResolvedValue(buildWork(run));
    transactionRepository.findOne.mockResolvedValue(
      buildRun({ status: 'cancelled' }),
    );

    provider.generate.mockResolvedValue({
      proposals: [
        { field: 'caption', value: 'legenda gerada', rationale: null },
      ],
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-copy-v1',
      usage: {},
      latencyMs: 10,
      attempts: 1,
    });

    await worker['processOne'](RUN_ID);

    expect(generationService.recordProposals).not.toHaveBeenCalled();
    expect(transactionRepository.save).not.toHaveBeenCalled();
  });

  it('reserves budget before calling the provider', async () => {
    const run = buildRun();
    runsRepository.findOneBy.mockResolvedValue(run);
    generationService.resolveWork.mockResolvedValue(buildWork(run));
    transactionRepository.findOne.mockResolvedValue(buildRun());
    provider.generate.mockResolvedValue({
      proposals: [{ field: 'caption', value: 'x', rationale: null }],
      provider: 'p',
      model: 'm',
      promptVersion: 'v',
      usage: {},
      latencyMs: 1,
      attempts: 1,
    });

    await worker['processOne'](RUN_ID);

    expect(runsRepository.update).toHaveBeenCalledWith(
      { id: RUN_ID },
      { costCents: 5 },
    );
  });

  /**
   * Re-checked here and not only at enqueue: a plan-wide request queues many
   * runs at once, and by the tenth claim the earlier ones have recorded real
   * cost.
   */
  it('fails without calling the provider when the budget ran out since enqueue', async () => {
    runsRepository.findOneBy.mockResolvedValue(buildRun());
    generationService.dailyBudgetRemaining.mockResolvedValue(1);

    await worker['processOne'](RUN_ID);

    expect(provider.generate).not.toHaveBeenCalled();
    expect(runsRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: RUN_ID, status: 'processing' }),
      expect.objectContaining({
        status: 'failed',
        lastError: 'generation_budget_exhausted',
      }),
    );
  });

  it('requeues a failure with backoff while attempts remain', async () => {
    runsRepository.findOneBy.mockResolvedValue(buildRun({ attempts: 1 }));
    generationService.resolveWork.mockRejectedValue(new Error('boom'));

    await worker['processOne'](RUN_ID);

    const requeue = runsRepository.update.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'queued',
    );

    expect(requeue).toBeDefined();
    expect((requeue?.[1] as { availableAt?: Date }).availableAt).toBeInstanceOf(
      Date,
    );
  });

  it('dead-letters once attempts are spent', async () => {
    runsRepository.findOneBy.mockResolvedValue(
      buildRun({ attempts: 3, maxAttempts: 3 }),
    );
    generationService.resolveWork.mockRejectedValue(new Error('boom'));

    await worker['processOne'](RUN_ID);

    expect(
      runsRepository.update.mock.calls.some(
        (call) => (call[1] as { status?: string }).status === 'dead_letter',
      ),
    ).toBe(true);
  });

  /**
   * A failure write that did not land means the row moved on — most often a
   * cancel. Reviving it into `queued` would charge for work that was stopped.
   */
  it('does not requeue when the failure write did not land', async () => {
    runsRepository.findOneBy.mockResolvedValue(buildRun({ attempts: 1 }));
    generationService.resolveWork.mockRejectedValue(new Error('boom'));
    runsRepository.update.mockResolvedValue({ affected: 0 });

    await worker['processOne'](RUN_ID);

    expect(runsRepository.update).toHaveBeenCalledTimes(2);
    expect(
      runsRepository.update.mock.calls.some(
        (call) => (call[1] as { status?: string }).status === 'queued',
      ),
    ).toBe(false);
  });

  /** An error code never carries the provider's own message. */
  it('stores only a short safe code on failure', async () => {
    runsRepository.findOneBy.mockResolvedValue(buildRun());
    generationService.resolveWork.mockRejectedValue(
      new Error('Provider said: your key sk-abc123 is invalid'),
    );

    await worker['processOne'](RUN_ID);

    const failure = runsRepository.update.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'failed',
    );

    expect((failure?.[1] as { lastError?: string }).lastError).toBe(
      'generation_failed',
    );
  });

  it('treats an empty result as a failure rather than a success with nothing', async () => {
    const run = buildRun();
    runsRepository.findOneBy.mockResolvedValue(run);
    generationService.resolveWork.mockResolvedValue(buildWork(run));
    provider.generate.mockResolvedValue({
      proposals: [],
      provider: 'p',
      model: 'm',
      promptVersion: 'v',
      usage: {},
      latencyMs: 1,
      attempts: 1,
    });

    await worker['processOne'](RUN_ID);

    const failure = runsRepository.update.mock.calls.find(
      (call) => (call[1] as { status?: string }).status === 'failed',
    );

    expect((failure?.[1] as { lastError?: string }).lastError).toBe(
      'generation_empty_result',
    );
  });

  /**
   * A run that reached the provider cost something, so the estimate must never
   * round down to zero and make the daily budget blind to it.
   */
  it('never estimates a cost below the reserve', async () => {
    const run = buildRun();
    runsRepository.findOneBy.mockResolvedValue(run);
    generationService.resolveWork.mockResolvedValue(buildWork(run));
    transactionRepository.findOne.mockResolvedValue(buildRun());
    provider.generate.mockResolvedValue({
      proposals: [{ field: 'caption', value: 'x', rationale: null }],
      provider: 'p',
      model: 'm',
      promptVersion: 'v',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
      attempts: 1,
    });

    await worker['processOne'](RUN_ID);

    expect(transactionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ costCents: 5 }),
    );
  });

  it('claims only due, unlocked runs and stale leases', async () => {
    claimQuery.mockResolvedValue([]);

    await worker.processPending(2);

    const sql = claimQuery.mock.calls[0][0] as string;

    expect(sql).toContain("status = 'queued'");
    expect(sql).toContain('available_at <= now()');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'processing'");
  });

  /**
   * Stamping `lockedBy` at claim time is what the per-row re-fetch later checks
   * against, and incrementing attempts there is what eventually dead-letters a
   * run that keeps crashing the worker before any failure write happens.
   */
  it('stamps the lease and counts the attempt when it claims a row', async () => {
    claimQuery.mockResolvedValue([{ id: RUN_ID }]);
    runsRepository.findOneBy.mockResolvedValue(null);

    await worker.processPending(1);

    const claimed = claimUpdate.mock.calls[0][0] as Record<string, unknown>;

    expect(claimed.status).toBe('processing');
    expect(claimed.lockedBy).toEqual(
      expect.stringContaining('social-copy-generation'),
    );
    expect(claimed.lockedAt).toBeInstanceOf(Date);
    expect(typeof claimed.attempts).toBe('function');
  });
});
