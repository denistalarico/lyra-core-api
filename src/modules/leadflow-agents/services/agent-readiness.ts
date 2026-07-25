import type { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import type { LeadFlowAgentChannelBindingEntity } from '../entities/leadflow-agent-channel-binding.entity';
import type { LeadFlowAgentEntity } from '../entities/leadflow-agent.entity';
import { LeadFlowAgentChannelStatus } from '../enums/leadflow-agent-channel-status.enum';
import type { LeadFlowAgentReadiness } from '../types/leadflow-agent.types';

/**
 * The configuration dependencies an agent needs before it can actually run.
 *
 * Each is a real signal, not a placeholder: a name to introduce itself, a
 * client context to speak from, a bound channel to reach the lead, and a
 * published version to run. Readiness is the single answer to "can this agent
 * work?", computed here so the write path (what we persist on the agent) and
 * the runtime contract (what a runtime reads) can never disagree.
 */
export const AGENT_READINESS_CHECKS = [
  'name',
  'client_context',
  'channels',
  'published_version',
] as const;

/**
 * Computes an agent's readiness from real dependencies. Pure and deterministic:
 * the same agent, settings and bindings always yield the same verdict. `missing`
 * names exactly the checks that failed, so a UI can tell the operator what to
 * fix rather than only that something is wrong.
 */
export function computeAgentReadiness(
  agent: Pick<LeadFlowAgentEntity, 'name' | 'publishedVersionId'>,
  settings: Pick<
    LeadFlowClientSettingsEntity,
    'clientPromptConfig' | 'companyContextPublished'
  > | null,
  bindings: Pick<LeadFlowAgentChannelBindingEntity, 'status'>[],
): LeadFlowAgentReadiness {
  const missing: string[] = [];

  if (!agent.name?.trim()) missing.push('name');
  if (!hasClientContext(settings)) missing.push('client_context');
  if (
    !bindings.some(
      (binding) => binding.status !== LeadFlowAgentChannelStatus.Unbound,
    )
  ) {
    missing.push('channels');
  }
  // A runtime has nothing to run without a published version, however complete
  // the rest of the configuration looks.
  if (!agent.publishedVersionId) missing.push('published_version');

  const total = AGENT_READINESS_CHECKS.length;
  const score = Math.round(((total - missing.length) / total) * 100);
  const level: NonNullable<LeadFlowAgentReadiness['level']> =
    missing.length === 0
      ? 'ready'
      : missing.length === 1
        ? 'partial'
        : 'not_ready';

  return { score, level, missing, checkedAt: new Date().toISOString() };
}

function hasClientContext(
  settings: Pick<
    LeadFlowClientSettingsEntity,
    'clientPromptConfig' | 'companyContextPublished'
  > | null,
): boolean {
  if (!settings) return false;
  return (
    isNonEmptyObject(settings.clientPromptConfig) ||
    isNonEmptyObject(settings.companyContextPublished)
  );
}

function isNonEmptyObject(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}
