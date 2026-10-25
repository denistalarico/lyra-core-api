import type { DataSource } from 'typeorm';
import type {
  AiCostEntryInput,
  AiCostLedgerService,
} from '../ai-costs/ai-cost-ledger.service';
import {
  OrionBudgetService,
  assertOrionLimits,
  estimateOrionCost,
  type OrionReservation,
} from './orion-budget.service';
import type { OrionConfigService } from './orion-config.service';

const limits = { monthlyBudgetUsd: 5, userHourlyLimit: 30, reserveUsd: 0.08 };
const prices = { input: 2.5, cached: 0.25, output: 15 };

const reservation = (provider = 'openai-compatible'): OrionReservation => ({
  id: 'turn-1',
  reservedCostUsd: 0.08,
  provider,
  model: 'gpt-5.6-terra',
  promptVersion: 'orion-v1',
  scope: {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    agencyClientId: null,
    companyContextId: null,
    userId: 'user',
    principal: 'agency',
    surface: 'operations_room',
  },
});

function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const record = jest
    .fn<Promise<{ inserted: number; upgraded: number }>, [AiCostEntryInput[]]>()
    .mockResolvedValue({ inserted: 1, upgraded: 0 });
  const config = {
    turnReserveUsd: 0.08,
    tenantMonthlyBudgetUsd: 5,
    prices: () => prices,
    pricingVersion: () => 'orion.gpt-5.6-terra.usd-mtok.2.5/0.25/15',
  } as unknown as OrionConfigService;
  const service = new OrionBudgetService(
    { query } as unknown as DataSource,
    config,
    { record } as unknown as AiCostLedgerService,
  );
  return { service, query, record };
}

const outcome = {
  usage: { inputTokens: 6400, cachedInputTokens: 4000, outputTokens: 470 },
  rounds: 2,
  attempts: 2,
  latencyMs: 1200,
  toolCalls: [{ name: 'list_agents', outcome: 'ok' as const }],
};

describe('Orion budget (D-OR-1)', () => {
  it('refuses at the hourly limit and when the reservation would cross the month', () => {
    expect(() =>
      assertOrionLimits({ monthSpendUsd: 0, userTurnsLastHour: 29 }, limits),
    ).not.toThrow();
    expect(() =>
      assertOrionLimits({ monthSpendUsd: 0, userTurnsLastHour: 30 }, limits),
    ).toThrow('orion_rate_limited');
    expect(() =>
      assertOrionLimits({ monthSpendUsd: 4.92, userTurnsLastHour: 0 }, limits),
    ).not.toThrow();
    expect(() =>
      assertOrionLimits({ monthSpendUsd: 4.93, userTurnsLastHour: 0 }, limits),
    ).toThrow('orion_budget_exhausted');
  });

  it('prices cached input separately and refuses incomplete usage', () => {
    // 2400 × 2.5 + 4000 × 0.25 + 470 × 15 = 14 050 → US$ 0,01405
    expect(estimateOrionCost(outcome.usage, prices)).toBe(0.01405);
    expect(estimateOrionCost({ inputTokens: 10 }, prices)).toBeNull();
    expect(estimateOrionCost(outcome.usage, null)).toBeNull();
  });

  it('settles a live turn at its priced cost and materializes it once in the cost ledger', async () => {
    const { service, query, record } = setup();
    await expect(service.succeed(reservation(), outcome)).resolves.toBe(
      0.01405,
    );
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE id = $1 AND status = 'reserved'");
    expect(params.slice(0, 3)).toEqual(['turn-1', 'succeeded', 0.01405]);
    expect(params[6]).toBe(JSON.stringify(outcome.toolCalls));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0][0]).toMatchObject({
      sourceDomain: 'orion',
      sourceType: 'orion_turn',
      sourceId: 'turn-1',
      outcome: 'succeeded',
      cost: {
        status: 'known',
        amount: '0.014050',
        currency: 'USD',
        source: 'lyra_calculated',
      },
      usage: { unit: 'tokens', quantity: '6870' },
    });
  });

  it('settles mock turns at zero and keeps them out of the cost ledger', async () => {
    const { service, query, record } = setup();
    await expect(service.succeed(reservation('mock'), outcome)).resolves.toBe(
      0,
    );
    expect((query.mock.calls[0] as [string, unknown[]])[1][2]).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('a failed call that never left costs nothing; one that left keeps its reservation', async () => {
    const { service, query, record } = setup();
    await service.fail(reservation(), {
      ...outcome,
      usage: {},
      attempts: 0,
      errorCode: 'orion_internal_error',
    });
    expect((query.mock.calls[0] as [string, unknown[]])[1].slice(1, 3)).toEqual(
      ['failed', 0],
    );
    expect(record).not.toHaveBeenCalled();

    await service.fail(reservation(), {
      ...outcome,
      usage: {},
      attempts: 1,
      errorCode: 'orion_provider_timeout',
    });
    expect((query.mock.calls[1] as [string, unknown[]])[1].slice(1, 3)).toEqual(
      ['failed', 0.08],
    );
    expect(record.mock.calls[0][0][0]).toMatchObject({
      outcome: 'failed',
      cost: { status: 'unknown', reason: 'outcome_unknown' },
    });
  });

  it('never fails the turn when the cost ledger is unavailable', async () => {
    const { service, record } = setup();
    record.mockRejectedValueOnce(new Error('ledger down'));
    await expect(service.succeed(reservation(), outcome)).resolves.toBe(
      0.01405,
    );
  });
});
