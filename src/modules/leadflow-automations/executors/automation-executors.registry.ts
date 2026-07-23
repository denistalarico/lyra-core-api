import { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import type { LeadFlowAutomationAction } from '../types/leadflow-automation.types';
import type { AutomationExecutorAvailability } from './automation-executor.types';
import { UnavailableExecutor } from './unavailable.executor';

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
    'send_message',
    'leadflow.inbox',
    'O adapter de envio canônico pelo Inbox ainda não foi conectado.',
    LeadFlowAutomationDependency.MessageGeneration,
  ),
  unavailable(
    'schedule_followup',
    'leadflow.automations',
    'O scheduler durável de follow-up ainda não existe.',
    LeadFlowAutomationDependency.SchedulerRuntime,
  ),
  unavailable(
    'notify_user',
    'platform.notifications',
    'O adapter governado de notificações ainda não foi implementado.',
  ),
  unavailable(
    'move_opportunity_stage',
    'leadflow.crm',
    'O command CRM existe, mas o adapter automático com ator e versão esperada ainda não foi implementado.',
  ),
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
    'request_handoff',
    'leadflow.inbox',
    'O command canônico de ownership/handoff ainda não está disponível ao Automations.',
    LeadFlowAutomationDependency.OwnershipCommand,
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

export function executorAvailability(
  actionKey: string,
): AutomationExecutorAvailability {
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
  return EXECUTORS.some((executor) => executor.availability().available);
}
