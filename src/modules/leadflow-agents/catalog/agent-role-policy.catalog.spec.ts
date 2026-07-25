import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import {
  AGENT_ROLE_POLICIES,
  resolveAgentRolePolicy,
} from './agent-role-policy.catalog';

describe('agent role policy', () => {
  it('lets a sales (Closer) agent attempt every commercial action', () => {
    const sales = AGENT_ROLE_POLICIES[LeadFlowAgentType.Sales];
    expect(sales.roleTitle).toBe('Closer');
    expect(sales.canProposeStageTransition).toBe(true);
    for (const action of [
      'set_stage',
      'set_service',
      'close',
      'handoff',
      'set_fact',
    ]) {
      expect(sales.allowedDecisionActions).toContain(action);
    }
  });

  it('titles the qualifier as SDR and lets it advance the stage', () => {
    const qualifier = AGENT_ROLE_POLICIES[LeadFlowAgentType.Qualifier];
    expect(qualifier.roleTitle).toBe('SDR');
    expect(qualifier.canProposeStageTransition).toBe(true);
    expect(qualifier.allowedDecisionActions).toContain('set_stage');
  });

  it('restricts support to observation and handoff', () => {
    const support = AGENT_ROLE_POLICIES[LeadFlowAgentType.Support];
    expect(support.canProposeStageTransition).toBe(false);
    expect(support.allowedDecisionActions).toEqual(
      expect.arrayContaining(['set_summary', 'set_urgency', 'add_tag', 'handoff']),
    );
    for (const forbidden of ['set_stage', 'set_service', 'close']) {
      expect(support.allowedDecisionActions).not.toContain(forbidden);
    }
  });

  it('keeps reception and concierge out of stage and close', () => {
    for (const type of [LeadFlowAgentType.Reception, LeadFlowAgentType.Concierge]) {
      const role = AGENT_ROLE_POLICIES[type];
      expect(role.canProposeStageTransition).toBe(false);
      expect(role.allowedDecisionActions).not.toContain('set_stage');
      expect(role.allowedDecisionActions).not.toContain('close');
    }
  });

  it('falls back to the permissive custom policy for an unknown type', () => {
    const resolved = resolveAgentRolePolicy('made_up_type');
    expect(resolved.type).toBe(LeadFlowAgentType.Custom);
    expect(resolved.canProposeStageTransition).toBe(true);
    expect(resolveAgentRolePolicy(null).type).toBe(LeadFlowAgentType.Custom);
  });
});
