import { LeadFlowWebhookGate } from './leadflow-webhook-gate.service';

describe('LeadFlowWebhookGate', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function gate(env: Record<string, string | undefined>): LeadFlowWebhookGate {
    process.env = { ...original, ...env };
    return new LeadFlowWebhookGate();
  }

  it('is closed with no configuration at all', () => {
    // A webhook is the one effect that leaves the building; it must never be
    // possible to turn on by forgetting to turn something off.
    const decision = gate({
      LEADFLOW_WEBHOOK_DISPATCH_ENABLED: undefined,
      LEADFLOW_WEBHOOK_DISPATCH_TENANTS: undefined,
    }).evaluate('tenant-1', 'workspace-1');

    expect(decision).toEqual({
      allowed: false,
      reason: 'dispatch_disabled',
    });
  });

  it('still refuses a workspace outside the allowlist', () => {
    const decision = gate({
      LEADFLOW_WEBHOOK_DISPATCH_ENABLED: 'true',
      LEADFLOW_WEBHOOK_DISPATCH_TENANTS: 'tenant-1:workspace-9',
    }).evaluate('tenant-1', 'workspace-1');

    expect(decision).toEqual({ allowed: false, reason: 'tenant_not_allowed' });
  });

  it('allows the named workspace once the switch is on', () => {
    const subject = gate({
      LEADFLOW_WEBHOOK_DISPATCH_ENABLED: 'true',
      LEADFLOW_WEBHOOK_DISPATCH_TENANTS: 'other:ws, tenant-1:workspace-1',
    });

    expect(subject.isEnabled()).toBe(true);
    expect(subject.evaluate('tenant-1', 'workspace-1')).toEqual({
      allowed: true,
    });
  });

  it('ignores an entry that does not name a workspace', () => {
    const subject = gate({
      LEADFLOW_WEBHOOK_DISPATCH_ENABLED: 'true',
      LEADFLOW_WEBHOOK_DISPATCH_TENANTS: 'tenant-1',
    });

    expect(subject.evaluate('tenant-1', 'workspace-1').allowed).toBe(false);
  });
});
