import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { LeadFlowAutomationRunEntity } from '../entities/leadflow-automation-run.entity';
import { LeadFlowAutomationRunMode } from '../enums/leadflow-automation-run.enums';

const AGENCY_CONNECTION = 'agency';

/**
 * Actions the canary is allowed to carry out.
 *
 * A non-terminal stage move, lead distribution and a governed handoff — each a
 * canonical command that only ever narrows (a stage the policy allows; an
 * unclaimed lead to a pipeline participant; a conversation to a human, which the
 * ownership command makes idempotent per cycle). Transfer and copy stay out even
 * though their commands exist: widening the set is a later, explicit decision.
 */
const CANARY_ACTION_ALLOWLIST = new Set<string>([
  'move_opportunity_stage',
  'assign_opportunity_owner',
  'request_handoff',
]);

export type ExecutionGateDecision =
  | { allowed: true }
  | { allowed: false; reason: ExecutionGateBlockReason };

export type ExecutionGateBlockReason =
  /** The global kill switch is off. Nothing executes anywhere. */
  | 'execution_disabled'
  /** This tenant/workspace is not in the canary allowlist. */
  | 'tenant_not_in_canary'
  /** The action is not one the canary may perform. */
  | 'action_not_allowed'
  /** The automation reached its execution cap for the current window. */
  | 'rate_limit_reached';

/** Parsed once at construction so a misconfiguration is visible immediately. */
interface GateConfig {
  enabled: boolean;
  tenants: Set<string>;
  maxPerHour: number;
}

/**
 * The safety boundary in front of every productive effect.
 *
 * Default-closed by construction: with no configuration, `enabled` is false and
 * nothing executes, so the canary can never turn itself on by accident. Turning
 * it on takes an explicit environment change naming both the switch and the
 * tenants, and it can be turned off again the same way with no deploy of code
 * or migration — the kill switch the roadmap called for.
 *
 * Capability and permission are kept apart. The executor's `availability`
 * answers "can the platform do this at all"; this gate answers "is this tenant
 * allowed to do it right now". A closed gate is never reported as a missing
 * capability, so switching the canary off does not make the UI claim the
 * feature vanished.
 */
@Injectable()
export class LeadFlowAutomationExecutionGate {
  private readonly config: GateConfig;

  constructor(
    @InjectRepository(LeadFlowAutomationRunEntity, AGENCY_CONNECTION)
    private readonly runs: Repository<LeadFlowAutomationRunEntity>,
  ) {
    this.config = readConfig(process.env);
  }

  /** Whether execution is enabled at all, for surfacing in diagnostics. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Whether one automation may execute one action right now.
   *
   * Checked in order of cost: the free structural checks (switch, allowlist,
   * action) before the rate-limit query, so a closed gate never touches the
   * database.
   */
  async evaluate(input: {
    tenantId: string;
    workspaceId: string;
    automationId: string;
    actionKeys: readonly string[];
  }): Promise<ExecutionGateDecision> {
    if (!this.config.enabled) {
      return { allowed: false, reason: 'execution_disabled' };
    }
    if (!this.config.tenants.has(scopeKey(input.tenantId, input.workspaceId))) {
      return { allowed: false, reason: 'tenant_not_in_canary' };
    }
    // Every planned action must be permitted. A recipe that pairs an allowed
    // action with a disallowed one does not get partial execution.
    const allActionsAllowed = input.actionKeys.every((action) =>
      CANARY_ACTION_ALLOWLIST.has(action),
    );
    if (input.actionKeys.length === 0 || !allActionsAllowed) {
      return { allowed: false, reason: 'action_not_allowed' };
    }

    const recent = await this.countLiveRunsInWindow(
      input.tenantId,
      input.workspaceId,
      input.automationId,
    );
    if (recent >= this.config.maxPerHour) {
      return { allowed: false, reason: 'rate_limit_reached' };
    }

    return { allowed: true };
  }

  /** Live runs this automation produced in the trailing hour. */
  private async countLiveRunsInWindow(
    tenantId: string,
    workspaceId: string,
    automationId: string,
  ): Promise<number> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    return this.runs.count({
      where: {
        tenantId,
        workspaceId,
        automationId,
        mode: LeadFlowAutomationRunMode.Live,
        createdAt: Between(since, new Date()),
      },
    });
  }
}

function scopeKey(tenantId: string, workspaceId: string): string {
  return `${tenantId}:${workspaceId}`;
}

/**
 * Reads the canary configuration from the environment.
 *
 * `LEADFLOW_AUTOMATION_EXECUTION_ENABLED` — the kill switch, off unless exactly
 *   'true'. Any other value, including unset, keeps execution disabled.
 * `LEADFLOW_AUTOMATION_EXECUTION_TENANTS` — comma-separated `tenantId:workspaceId`
 *   pairs allowed to execute. Empty means no one, even if the switch is on.
 * `LEADFLOW_AUTOMATION_EXECUTION_MAX_PER_HOUR` — per-automation cap; a sane,
 *   low default so a misconfigured recipe cannot storm the pipeline.
 */
function readConfig(env: NodeJS.ProcessEnv): GateConfig {
  const enabled = env.LEADFLOW_AUTOMATION_EXECUTION_ENABLED === 'true';
  const tenants = new Set(
    (env.LEADFLOW_AUTOMATION_EXECUTION_TENANTS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.includes(':')),
  );
  const parsedMax = Number(env.LEADFLOW_AUTOMATION_EXECUTION_MAX_PER_HOUR);
  const maxPerHour =
    Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : 20;
  return { enabled, tenants, maxPerHour };
}
