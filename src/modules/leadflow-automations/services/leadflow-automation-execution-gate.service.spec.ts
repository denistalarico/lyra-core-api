import type { Repository } from 'typeorm';
import type { LeadFlowAutomationRunEntity } from '../entities/leadflow-automation-run.entity';
import { LeadFlowAutomationExecutionGate } from './leadflow-automation-execution-gate.service';

const CANARY = 'tenant-1:workspace-1';

function build(
  env: NodeJS.ProcessEnv,
  liveRunCount = 0,
): { gate: LeadFlowAutomationExecutionGate; count: jest.Mock } {
  const original = process.env;
  process.env = { ...original, ...env };
  const count = jest.fn().mockResolvedValue(liveRunCount);
  const runs = { count } as unknown as Repository<LeadFlowAutomationRunEntity>;
  const gate = new LeadFlowAutomationExecutionGate(runs);
  process.env = original;
  return { gate, count };
}

const input = (overrides = {}) => ({
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  automationId: 'automation-1',
  actionKeys: ['move_opportunity_stage'],
  ...overrides,
});

describe('LeadFlowAutomationExecutionGate', () => {
  it('is closed by default with no configuration', async () => {
    const { gate } = build({});

    expect(gate.isEnabled()).toBe(false);
    const decision = await gate.evaluate(input());
    expect(decision).toEqual({
      allowed: false,
      reason: 'execution_disabled',
    });
  });

  it('stays closed when the switch is anything other than the exact string true', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
      const { gate } = build({
        LEADFLOW_AUTOMATION_EXECUTION_ENABLED: value,
        LEADFLOW_AUTOMATION_EXECUTION_TENANTS: CANARY,
      });
      const decision = await gate.evaluate(input());
      expect(decision.allowed).toBe(false);
    }
  });

  it('refuses a tenant not in the canary allowlist even when enabled', async () => {
    const { gate } = build({
      LEADFLOW_AUTOMATION_EXECUTION_ENABLED: 'true',
      LEADFLOW_AUTOMATION_EXECUTION_TENANTS: 'other:workspace',
    });

    const decision = await gate.evaluate(input());
    expect(decision).toEqual({
      allowed: false,
      reason: 'tenant_not_in_canary',
    });
  });

  it('refuses an action outside the canary allowlist', async () => {
    const { gate } = build({
      LEADFLOW_AUTOMATION_EXECUTION_ENABLED: 'true',
      LEADFLOW_AUTOMATION_EXECUTION_TENANTS: CANARY,
    });

    // Transfer is not allowed this phase, even paired with an allowed action.
    const decision = await gate.evaluate(
      input({
        actionKeys: ['move_opportunity_stage', 'transfer_opportunity_pipeline'],
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'action_not_allowed' });
  });

  it('refuses when the automation has no planned actions', async () => {
    const { gate } = build({
      LEADFLOW_AUTOMATION_EXECUTION_ENABLED: 'true',
      LEADFLOW_AUTOMATION_EXECUTION_TENANTS: CANARY,
    });

    const decision = await gate.evaluate(input({ actionKeys: [] }));
    expect(decision).toEqual({ allowed: false, reason: 'action_not_allowed' });
  });

  it('does not touch the database while the gate is closed', async () => {
    const { gate, count } = build({});

    await gate.evaluate(input());
    expect(count).not.toHaveBeenCalled();
  });

  it('allows a canary tenant under the rate limit', async () => {
    const { gate } = build(
      {
        LEADFLOW_AUTOMATION_EXECUTION_ENABLED: 'true',
        LEADFLOW_AUTOMATION_EXECUTION_TENANTS: CANARY,
        LEADFLOW_AUTOMATION_EXECUTION_MAX_PER_HOUR: '20',
      },
      5,
    );

    const decision = await gate.evaluate(input());
    expect(decision).toEqual({ allowed: true });
  });

  it('refuses once the per-automation cap is reached', async () => {
    const { gate } = build(
      {
        LEADFLOW_AUTOMATION_EXECUTION_ENABLED: 'true',
        LEADFLOW_AUTOMATION_EXECUTION_TENANTS: CANARY,
        LEADFLOW_AUTOMATION_EXECUTION_MAX_PER_HOUR: '5',
      },
      5,
    );

    const decision = await gate.evaluate(input());
    expect(decision).toEqual({ allowed: false, reason: 'rate_limit_reached' });
  });

  it('parses several allowlisted tenants', async () => {
    const { gate } = build({
      LEADFLOW_AUTOMATION_EXECUTION_ENABLED: 'true',
      LEADFLOW_AUTOMATION_EXECUTION_TENANTS: 'a:b, tenant-1:workspace-1 ,c:d',
    });

    const decision = await gate.evaluate(input());
    expect(decision).toEqual({ allowed: true });
  });
});
