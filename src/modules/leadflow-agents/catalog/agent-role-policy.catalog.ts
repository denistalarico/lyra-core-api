import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';

/**
 * The commercial actions an agent decision may resolve to.
 *
 * Mirrors the action-plan vocabulary the inbox runtime enforces
 * (`BusinessModeActionPlanner`). Kept here, on the agent side, so the role
 * policy is the single place that decides which of them a given agent type may
 * even attempt — rather than the runtime hard-coding one list for every agent.
 */
export type AgentDecisionActionType =
  | 'set_stage'
  | 'add_tag'
  | 'set_summary'
  | 'set_service'
  | 'set_urgency'
  | 'set_fact'
  | 'close'
  | 'handoff';

/**
 * What one agent type is for, and the actions its decisions may resolve to.
 *
 * This formalises "role" per agent type: the objective it pursues, the
 * operator-facing title, and the exact set of commercial actions it is allowed
 * to attempt. It is the policy the audit calls for — a validated decision that
 * proposes an action outside this set is refused, rather than silently carried
 * out because the runtime offered every action to every agent.
 *
 * `canProposeStageTransition` is derived from the action set (it is exactly
 * `set_stage ∈ allowedDecisionActions`) but stated explicitly because the
 * runtime reads it directly when narrowing what it offers the model.
 */
export interface AgentRolePolicy {
  type: LeadFlowAgentType;
  /** Operator-facing role name. SDR for qualifier, Closer for sales, etc. */
  roleTitle: string;
  /** One line describing what the role pursues. */
  objective: string;
  allowedDecisionActions: readonly AgentDecisionActionType[];
  canProposeStageTransition: boolean;
}

// Every role may summarise, set urgency, tag, extract facts and hand off — these
// are observation and escalation, harmless regardless of role. What a role gates
// is the commercially significant writes: advancing the stage, setting the
// service, and closing the opportunity.
const BASE_ACTIONS: readonly AgentDecisionActionType[] = [
  'add_tag',
  'set_summary',
  'set_urgency',
  'set_fact',
  'handoff',
];

function policy(
  type: LeadFlowAgentType,
  roleTitle: string,
  objective: string,
  commercialActions: readonly AgentDecisionActionType[],
): AgentRolePolicy {
  const allowedDecisionActions = [
    ...BASE_ACTIONS,
    ...commercialActions.filter((action) => !BASE_ACTIONS.includes(action)),
  ];
  return {
    type,
    roleTitle,
    objective,
    allowedDecisionActions,
    canProposeStageTransition: allowedDecisionActions.includes('set_stage'),
  };
}

export const AGENT_ROLE_POLICIES: Record<LeadFlowAgentType, AgentRolePolicy> = {
  [LeadFlowAgentType.Reception]: policy(
    LeadFlowAgentType.Reception,
    'Recepção',
    'Receber, entender a intenção inicial e direcionar o contato.',
    [],
  ),
  [LeadFlowAgentType.Qualifier]: policy(
    LeadFlowAgentType.Qualifier,
    'SDR',
    'Qualificar fit, urgência e contexto e avançar o lead no funil.',
    ['set_stage', 'set_service', 'close'],
  ),
  [LeadFlowAgentType.Scheduler]: policy(
    LeadFlowAgentType.Scheduler,
    'Agendamento',
    'Conduzir o lead até um agendamento confirmado.',
    ['set_stage'],
  ),
  [LeadFlowAgentType.Sales]: policy(
    LeadFlowAgentType.Sales,
    'Closer',
    'Conduzir a venda consultiva, endereçar objeções e levar ao fechamento.',
    ['set_stage', 'set_service', 'close'],
  ),
  [LeadFlowAgentType.Support]: policy(
    LeadFlowAgentType.Support,
    'Suporte',
    'Responder dúvidas e resolver pedidos simples, escalando quando necessário.',
    [],
  ),
  [LeadFlowAgentType.Concierge]: policy(
    LeadFlowAgentType.Concierge,
    'Concierge',
    'Acolher, orientar e encaminhar o contato ao destino certo.',
    [],
  ),
  // A custom agent has no fixed archetype; it is developer-configured, so the
  // policy stays permissive (every action) rather than second-guessing it.
  [LeadFlowAgentType.Custom]: policy(
    LeadFlowAgentType.Custom,
    'Personalizado',
    'Objetivo definido pela configuração do agente.',
    ['set_stage', 'set_service', 'close'],
  ),
};

/**
 * The role policy for an agent type, falling back to the permissive custom
 * policy for an unknown value — an unrecognised type must not silently lose the
 * ability to act, only a recognised restrictive one narrows it.
 */
export function resolveAgentRolePolicy(
  type: string | null | undefined,
): AgentRolePolicy {
  return (
    AGENT_ROLE_POLICIES[type as LeadFlowAgentType] ??
    AGENT_ROLE_POLICIES[LeadFlowAgentType.Custom]
  );
}
