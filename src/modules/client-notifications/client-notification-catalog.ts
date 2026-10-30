export type ClientNotificationType =
  | 'approval.pending'
  | 'approval.reminder'
  | 'conversation.message'
  | 'invoice.due_soon'
  | 'invoice.overdue'
  | 'contract.signature_pending'
  | 'deliverable.published';

export type ClientNotificationChannel =
  | 'in_app'
  | 'push'
  | 'email'
  | 'whatsapp';

export type ClientNotificationDefinition = {
  type: ClientNotificationType;
  label: string;
  requiredPermission: string;
  requiredModule: string;
  channels: readonly ClientNotificationChannel[];
  eventTypes: readonly string[];
};

const CHANNELS = ['in_app', 'push', 'email', 'whatsapp'] as const;

export const CLIENT_NOTIFICATION_CATALOG: Record<
  ClientNotificationType,
  ClientNotificationDefinition
> = {
  'approval.pending': {
    type: 'approval.pending',
    label: 'Aprovação pendente',
    requiredPermission: 'client_area.approvals.view',
    requiredModule: 'approvals',
    channels: CHANNELS,
    eventTypes: ['social.approval.awaiting_client'],
  },
  'approval.reminder': {
    type: 'approval.reminder',
    label: 'Lembrete de aprovação',
    requiredPermission: 'client_area.approvals.view',
    requiredModule: 'approvals',
    channels: CHANNELS,
    eventTypes: ['social.approval.reminder'],
  },
  'conversation.message': {
    type: 'conversation.message',
    label: 'Nova mensagem',
    requiredPermission: 'client_area.conversations.view',
    requiredModule: 'conversations',
    channels: CHANNELS,
    eventTypes: ['client_conversation.message.created'],
  },
  'invoice.due_soon': {
    type: 'invoice.due_soon',
    label: 'Fatura perto do vencimento',
    requiredPermission: 'client_area.agency_billing.view',
    requiredModule: 'agency_billing',
    channels: CHANNELS,
    eventTypes: ['finance.invoice_due_soon'],
  },
  'invoice.overdue': {
    type: 'invoice.overdue',
    label: 'Fatura vencida',
    requiredPermission: 'client_area.agency_billing.view',
    requiredModule: 'agency_billing',
    channels: CHANNELS,
    eventTypes: ['finance.invoice_overdue'],
  },
  'contract.signature_pending': {
    type: 'contract.signature_pending',
    label: 'Assinatura pendente',
    requiredPermission: 'client_area.agency_billing.view',
    requiredModule: 'agency_billing',
    channels: CHANNELS,
    eventTypes: [
      'contract.manual_signature_pending',
      'contract.signature_reminder_due',
    ],
  },
  'deliverable.published': {
    type: 'deliverable.published',
    label: 'Entrega publicada',
    requiredPermission: 'client_area.projects.view',
    requiredModule: 'agency_projects',
    channels: CHANNELS,
    eventTypes: ['project.deliverable_ready'],
  },
};

const DEFINITION_BY_EVENT = new Map(
  Object.values(CLIENT_NOTIFICATION_CATALOG).flatMap((definition) =>
    definition.eventTypes.map((eventType) => [eventType, definition] as const),
  ),
);

export function clientNotificationDefinitionForEvent(eventType: string) {
  return DEFINITION_BY_EVENT.get(eventType) ?? null;
}

export function clientNotificationDefinition(type: string) {
  return CLIENT_NOTIFICATION_CATALOG[type as ClientNotificationType] ?? null;
}
