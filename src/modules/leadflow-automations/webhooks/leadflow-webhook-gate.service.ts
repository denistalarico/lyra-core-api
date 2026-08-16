import { Injectable } from '@nestjs/common';

export interface WebhookGateDecision {
  allowed: boolean;
  reason?: 'dispatch_disabled' | 'tenant_not_allowed';
}

interface GateConfig {
  enabled: boolean;
  tenants: Set<string>;
}

/**
 * The switch in front of every outbound webhook.
 *
 * A webhook is the first thing in the platform that sends *customer data to an
 * address a customer typed*. Everything else the automations do stays inside
 * systems we operate, so this is the one effect where a configuration mistake
 * leaves the building. It therefore gets the same treatment the canary executor
 * got: default-closed, with no way to open it from the product — turning it on
 * takes an environment change naming both the switch and the tenants, and
 * turning it off again takes neither a deploy nor a migration.
 *
 * The endpoint being configured, enabled and subscribed is not enough. That is
 * deliberate: "ready but not firing" is exactly the state this ships in.
 */
@Injectable()
export class LeadFlowWebhookGate {
  private readonly config: GateConfig;

  constructor() {
    this.config = readConfig(process.env);
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  evaluate(tenantId: string, workspaceId: string): WebhookGateDecision {
    if (!this.config.enabled) {
      return { allowed: false, reason: 'dispatch_disabled' };
    }
    if (!this.config.tenants.has(`${tenantId}:${workspaceId}`)) {
      return { allowed: false, reason: 'tenant_not_allowed' };
    }
    return { allowed: true };
  }
}

function readConfig(env: NodeJS.ProcessEnv): GateConfig {
  return {
    enabled: env.LEADFLOW_WEBHOOK_DISPATCH_ENABLED === 'true',
    tenants: new Set(
      (env.LEADFLOW_WEBHOOK_DISPATCH_TENANTS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.includes(':')),
    ),
  };
}
