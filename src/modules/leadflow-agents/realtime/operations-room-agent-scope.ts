import { Repository } from 'typeorm';
import { LeadFlowAgentEntity } from '../entities/leadflow-agent.entity';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type { OperationsRoomScope } from './operations-room-realtime.constants';

/**
 * Resolves the Operations Room room scope for an event from the persisted
 * Agent root — never from event payload, which is untrusted authority (see
 * CC2F.2 event ownership rule). Mirrors `resolveInboxCompanyScope`'s use of
 * the persisted Conversation/Channel from CC2E.
 *
 * Fails closed: an agent that no longer exists, or that carries an
 * inconsistent client/company pair (legacy `agencyClientId` without a
 * `companyContextId`, or vice versa), resolves to `null` so the caller drops
 * the event instead of guessing a room.
 */
export async function resolveOperationsRoomAgentScope(
  agents: Repository<LeadFlowAgentEntity>,
  tenantId: string,
  workspaceId: string,
  agentId: string | null,
): Promise<OperationsRoomScope | null> {
  if (!agentId) return null;
  const agent = await agents.findOne({
    select: {
      id: true,
      tenantId: true,
      workspaceId: true,
      contextType: true,
      agencyClientId: true,
      companyContextId: true,
    },
    where: { id: agentId, tenantId, workspaceId },
  });
  if (!agent) return null;
  return operationsRoomScopeForAgent(agent);
}

export function operationsRoomScopeForAgent(
  agent: Pick<
    LeadFlowAgentEntity,
    'contextType' | 'agencyClientId' | 'companyContextId'
  >,
): OperationsRoomScope | null {
  if (agent.contextType === LeadFlowSettingsContextType.Agency) {
    return agent.agencyClientId || agent.companyContextId
      ? null
      : { scopeKind: 'agency', agencyClientId: null, companyContextId: null };
  }
  if (agent.contextType === LeadFlowSettingsContextType.Client) {
    return agent.agencyClientId && agent.companyContextId
      ? {
          scopeKind: 'company',
          agencyClientId: agent.agencyClientId,
          companyContextId: agent.companyContextId,
        }
      : null;
  }
  return null;
}
