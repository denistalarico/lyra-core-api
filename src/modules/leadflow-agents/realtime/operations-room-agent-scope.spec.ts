import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  operationsRoomScopeForAgent,
  resolveOperationsRoomAgentScope,
} from './operations-room-agent-scope';

describe('resolveOperationsRoomAgentScope', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';

  it('resolves Agent A to Company A', async () => {
    const agents = {
      findOne: jest.fn().mockResolvedValue({
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-x',
        companyContextId: 'company-a',
      }),
    };
    const scope = await resolveOperationsRoomAgentScope(
      agents as never,
      tenantId,
      workspaceId,
      'agent-a',
    );
    expect(scope).toEqual({
      scopeKind: 'company',
      agencyClientId: 'client-x',
      companyContextId: 'company-a',
    });
  });

  it('resolves Agent B to Company B, distinct from Company A of the same client', async () => {
    const agents = {
      findOne: jest.fn().mockResolvedValue({
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-x',
        companyContextId: 'company-b',
      }),
    };
    const scope = await resolveOperationsRoomAgentScope(
      agents as never,
      tenantId,
      workspaceId,
      'agent-b',
    );
    expect(scope).toEqual({
      scopeKind: 'company',
      agencyClientId: 'client-x',
      companyContextId: 'company-b',
    });
  });

  it('returns null for a nonexistent agent', async () => {
    const agents = { findOne: jest.fn().mockResolvedValue(null) };
    const scope = await resolveOperationsRoomAgentScope(
      agents as never,
      tenantId,
      workspaceId,
      'missing-agent',
    );
    expect(scope).toBeNull();
  });

  it('returns null for a null agentId', async () => {
    const agents = { findOne: jest.fn() };
    const scope = await resolveOperationsRoomAgentScope(
      agents as never,
      tenantId,
      workspaceId,
      null,
    );
    expect(scope).toBeNull();
    expect(agents.findOne).not.toHaveBeenCalled();
  });

  it('fails closed for a legacy client agent missing companyContextId', () => {
    const scope = operationsRoomScopeForAgent({
      contextType: LeadFlowSettingsContextType.Client,
      agencyClientId: 'client-x',
      companyContextId: null,
    });
    expect(scope).toBeNull();
  });

  it('fails closed for a cross-scope agent (agency contextType with a client id set)', () => {
    const scope = operationsRoomScopeForAgent({
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: 'client-x',
      companyContextId: 'company-a',
    });
    expect(scope).toBeNull();
  });

  it('resolves a clean agency agent to the agency scope', () => {
    const scope = operationsRoomScopeForAgent({
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      companyContextId: null,
    });
    expect(scope).toEqual({
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
    });
  });
});
