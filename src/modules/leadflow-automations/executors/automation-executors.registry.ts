import { isDependencySatisfied } from '../catalog/automation-dependencies.registry';
import { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import type { LeadFlowAutomationAction } from '../types/leadflow-automation.types';
import type { AutomationExecutorAvailability } from './automation-executor.types';
import { UnavailableExecutor } from './unavailable.executor';

/**
 * Availability of the governed stage-transition action.
 *
 * Distinct from the other entries because a real executor exists for it
 * (`MoveOpportunityStageExecutor`), gated at run time by the execution gate.
 * Here we only report capability: the canonical command is callable, so the
 * action is available. Whether it is *permitted* to run for a given tenant is
 * the gate's decision, made separately, so a closed gate never looks like a
 * missing capability.
 */
function stageTransitionAvailability(): AutomationExecutorAvailability {
  const available = isDependencySatisfied(
    LeadFlowAutomationDependency.StageTransitionCommand,
  );
  return {
    actionKey: 'move_opportunity_stage',
    available,
    reason: available ? null : 'dependency_missing',
    dependency: available
      ? null
      : LeadFlowAutomationDependency.StageTransitionCommand,
    owningDomain: 'leadflow.crm',
    description: available
      ? 'Transição governada de etapa via comando canônico do CRM (ator automation, etapas não terminais).'
      : 'O comando canônico de transição de etapa ainda não está disponível.',
  };
}

/**
 * Availability of the lead-distribution action. Like the stage transition, a
 * real executor exists (`AssignOpportunityOwnerExecutor`) and its capability is
 * the CRM's canonical distribution command; whether a given tenant may run it is
 * the gate's separate decision.
 */
function leadDistributionAvailability(): AutomationExecutorAvailability {
  const available = isDependencySatisfied(
    LeadFlowAutomationDependency.LeadDistributionCommand,
  );
  return {
    actionKey: 'assign_opportunity_owner',
    available,
    reason: available ? null : 'dependency_missing',
    dependency: available
      ? null
      : LeadFlowAutomationDependency.LeadDistributionCommand,
    owningDomain: 'leadflow.crm',
    description: available
      ? 'Distribuição de leads via comando canônico do CRM (ator automation, apenas leads abertos e sem dono).'
      : 'O comando canônico de distribuição de leads ainda não está disponível.',
  };
}

/**
 * Availability of the governed handoff action. A real executor exists
 * (`RequestHandoffExecutor`) and its capability is the inbox's canonical
 * `requestHandoff` command; whether a given tenant may run it is the gate's
 * separate decision.
 */
function ownershipCommandAvailability(): AutomationExecutorAvailability {
  const available = isDependencySatisfied(
    LeadFlowAutomationDependency.OwnershipCommand,
  );
  return {
    actionKey: 'request_handoff',
    available,
    reason: available ? null : 'dependency_missing',
    dependency: available
      ? null
      : LeadFlowAutomationDependency.OwnershipCommand,
    owningDomain: 'leadflow.inbox',
    description: available
      ? 'Handoff governado da conversa via comando canônico do Inbox (ator automation, notificação in-app idempotente por ciclo).'
      : 'O comando canônico de ownership/handoff ainda não está disponível ao Automations.',
  };
}

/**
 * Availability of the internal-notification action. Unlike the CRM/inbox
 * commands, the platform's Notifications layer is unconditional core infra — no
 * dependency gates it — so once the adapter (`NotifyUserExecutor`) exists the
 * capability is simply available. Whether a tenant may run it is the gate's
 * separate decision.
 */
function notifyUserAvailability(): AutomationExecutorAvailability {
  return {
    actionKey: 'notify_user',
    available: true,
    reason: null,
    dependency: null,
    owningDomain: 'platform.notifications',
    description:
      'Notificação interna in-app (+ realtime) via a camada de Notifications da plataforma.',
  };
}

function sendMessageAvailability(): AutomationExecutorAvailability {
  const available = isDependencySatisfied(
    LeadFlowAutomationDependency.MessageGeneration,
  );
  return {
    actionKey: 'send_message',
    available,
    reason: available ? null : 'dependency_missing',
    dependency: available
      ? null
      : LeadFlowAutomationDependency.MessageGeneration,
    owningDomain: 'leadflow.inbox',
    description: available
      ? 'Envio WhatsApp governado pelo Inbox, com texto apenas na janela de 24h e template obrigatório fora dela.'
      : 'O comando canônico de mensagem automática ainda não está disponível.',
  };
}

function scheduleFollowupAvailability(): AutomationExecutorAvailability {
  const available = isDependencySatisfied(
    LeadFlowAutomationDependency.SchedulerRuntime,
  );
  return {
    actionKey: 'schedule_followup',
    available,
    reason: available ? null : 'dependency_missing',
    dependency: available
      ? null
      : LeadFlowAutomationDependency.SchedulerRuntime,
    owningDomain: 'leadflow.automations',
    description: available
      ? 'Follow-up agendado no SchedulerRuntime durável em PostgreSQL.'
      : 'O scheduler durável de follow-up ainda não está disponível.',
  };
}

const unavailable = (
  actionKey: LeadFlowAutomationAction,
  owningDomain: string,
  description: string,
  dependency: LeadFlowAutomationDependency | null = null,
) =>
  new UnavailableExecutor(
    actionKey,
    dependency ? 'dependency_missing' : 'not_implemented',
    owningDomain,
    description,
    dependency,
  );

/**
 * Explicit registry for every action key in the published recipe catalog.
 *
 * A canonical domain command being callable does not mean an event-driven
 * executor exists. The three CRM commands remain `not_implemented` here until
 * ingress can resolve the event actor, expected row version and policy-bound
 * payload without inventing privilege.
 */
const EXECUTORS = [
  unavailable(
    'transfer_opportunity_pipeline',
    'leadflow.crm',
    'O command CRM existe, mas o adapter automático com ator e versão esperada ainda não foi implementado.',
  ),
  unavailable(
    'copy_opportunity',
    'leadflow.crm',
    'O command CRM existe, mas o adapter automático com ator e versão esperada ainda não foi implementado.',
  ),
  unavailable(
    'update_opportunity_score',
    'leadflow.crm',
    'Não há executor canônico de score conectado ao Automations.',
  ),
  unavailable(
    'add_tag',
    'leadflow.crm',
    'Não há executor canônico de tags conectado ao Automations.',
  ),
  unavailable(
    'request_missing_fields',
    'leadflow.crm',
    'O detector de campos obrigatórios ainda não existe.',
    LeadFlowAutomationDependency.MissingFieldsDetector,
  ),
  unavailable(
    'create_task',
    'agency.projects',
    'O adapter governado de criação de tarefas ainda não foi implementado.',
  ),
  unavailable(
    'send_webhook',
    'leadflow.automations',
    'O dispatcher seguro de webhooks ainda não existe.',
    LeadFlowAutomationDependency.WebhookDispatch,
  ),
  unavailable(
    'append_note',
    'leadflow.crm',
    'Não há command canônico de notas conectado ao Automations.',
  ),
  unavailable(
    'generate_summary_placeholder',
    'leadflow.analytics',
    'O executor de resumo depende do backend analítico.',
    LeadFlowAutomationDependency.AnalyticsBackend,
  ),
] as const;

const BY_ACTION = new Map(
  EXECUTORS.map((executor) => [executor.actionKey, executor]),
);

/**
 * Availability descriptors that are computed rather than fixed, because a real
 * executor exists and its capability depends on a platform dependency.
 */
const COMPUTED_AVAILABILITY: Record<
  string,
  () => AutomationExecutorAvailability
> = {
  move_opportunity_stage: stageTransitionAvailability,
  assign_opportunity_owner: leadDistributionAvailability,
  request_handoff: ownershipCommandAvailability,
  notify_user: notifyUserAvailability,
  send_message: sendMessageAvailability,
  schedule_followup: scheduleFollowupAvailability,
};

export function executorAvailability(
  actionKey: string,
): AutomationExecutorAvailability {
  const computed = COMPUTED_AVAILABILITY[actionKey];
  if (computed) return computed();

  const executor = BY_ACTION.get(actionKey as LeadFlowAutomationAction);
  return executor
    ? executor.availability()
    : {
        actionKey,
        available: false,
        reason: 'not_implemented',
        dependency: null,
        owningDomain: 'unknown',
        description: 'Ação sem executor registrado.',
      };
}

export function unavailableExecutors(
  actionKeys: readonly string[],
): AutomationExecutorAvailability[] {
  return [...new Set(actionKeys)]
    .map(executorAvailability)
    .filter((availability) => !availability.available);
}

export function hasAvailableExecutor(): boolean {
  return (
    EXECUTORS.some((executor) => executor.availability().available) ||
    Object.values(COMPUTED_AVAILABILITY).some((fn) => fn().available)
  );
}
