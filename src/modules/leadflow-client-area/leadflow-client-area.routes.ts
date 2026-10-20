import type { ClientAreaModuleKey } from '../client-area/client-area.types';

export type LeadFlowClientKind =
  | 'channel'
  | 'conversation'
  | 'message'
  | 'media'
  | 'outbound'
  | 'settings'
  | 'contact'
  | 'contact-list'
  | 'pipeline'
  | 'stage'
  | 'tag'
  | 'opportunity'
  | 'appointment'
  | 'agenda'
  | 'participant'
  | 'reminder'
  | 'agent'
  | 'preset'
  | 'catalog';
export type LeadFlowClientRoute = {
  method: string;
  path: string;
  module: ClientAreaModuleKey;
  kind: LeadFlowClientKind;
  fields: readonly string[];
};
const routes: LeadFlowClientRoute[] = [];
const add = (
  module: ClientAreaModuleKey,
  kind: LeadFlowClientKind,
  method: string,
  path: string,
  fields: readonly string[] = [],
) => routes.push({ module, kind, method, path, fields });
const inbox = (
  kind: LeadFlowClientKind,
  method: string,
  path: string,
  fields?: readonly string[],
) => add('leadflow_inbox', kind, method, `/inbox${path}`, fields);
const crm = (
  kind: LeadFlowClientKind,
  method: string,
  path: string,
  fields?: readonly string[],
) => add('leadflow_crm', kind, method, `/crm${path}`, fields);
const conversation = [
  'channelId',
  'contactId',
  'externalThreadId',
  'title',
  'status',
  'priority',
  'assignedUserId',
  'assignedAgentId',
  'source',
  'businessMode',
];
inbox('channel', 'GET', '/channels');
inbox('conversation', 'GET', '/conversations');
inbox('conversation', 'POST', '/conversations', conversation);
inbox('conversation', 'GET', '/conversations/:id');
inbox('conversation', 'PATCH', '/conversations/:id', conversation);
for (const action of [
  'mark-read',
  'mark-unread',
  'archive',
  'unarchive',
  'pin',
  'favorite',
  'mute',
  'block',
  'assume',
  'handoff',
  'pause-ai',
  'return-ai',
  'close',
])
  inbox('conversation', 'POST', `/conversations/:id/${action}`, ['reason']);
inbox('message', 'GET', '/conversations/:id/messages');
// This resource writes notes only. External replies use the canonical channel outbox.
inbox('message', 'POST', '/conversations/:id/messages', [
  'content',
  'messageType',
  'direction',
]);
for (const action of ['reaction', 'pin', 'favorite'])
  inbox('message', 'POST', `/conversations/:id/messages/:messageId/${action}`, [
    'emoji',
    'enabled',
  ]);
inbox('media', 'GET', '/media/:mediaId/content');
inbox('settings', 'GET', '/settings');
inbox('settings', 'PATCH', '/settings', ['quickReplies']);
for (const channel of ['whatsapp', 'instagram', 'facebook-messenger']) {
  inbox('outbound', 'POST', `/channels/${channel}/send-text`, [
    'channelId',
    'conversationId',
    'to',
    'text',
    'replyToMessageId',
    'idempotencyKey',
  ]);
  inbox('outbound', 'POST', `/channels/${channel}/send-media`, [
    'channelId',
    'conversationId',
    'to',
    'caption',
    'replyToMessageId',
    'idempotencyKey',
  ]);
}
for (const [kind, path, fields] of [
  [
    'pipeline',
    'pipelines',
    [
      'name',
      'description',
      'businessMode',
      'status',
      'sortOrder',
      'isDefault',
      'visibility',
      'ownerUserId',
      'channels',
      'allowedUserIds',
    ],
  ],
  [
    'stage',
    'stages',
    [
      'pipelineId',
      'name',
      'description',
      'color',
      'sortOrder',
      'probability',
      'type',
      'isWonStage',
      'isLostStage',
      'isInitialStage',
      'isFolded',
      'operationMode',
      'role',
    ],
  ],
  [
    'tag',
    'tags',
    ['name', 'slug', 'color', 'icon', 'description', 'scope', 'ownerUserId'],
  ],
] as const) {
  crm(kind, 'GET', `/${path}`);
  crm(kind, 'GET', `/${path}/:id`);
  crm(kind, 'POST', `/${path}`, fields);
  crm(kind, 'PATCH', `/${path}/:id`, fields);
}
crm('stage', 'PATCH', '/stages/reorder', ['stages']);
crm('stage', 'PATCH', '/stages/:id/fold', ['isFolded']);
for (const path of ['opportunity-fields', 'loss-reasons'])
  crm('catalog', 'GET', `/${path}`);
const opportunity = [
  'pipelineId',
  'stageId',
  'contactId',
  'contactName',
  'contactEmail',
  'contactPhone',
  'inboxConversationId',
  'title',
  'description',
  'valueAmount',
  'currency',
  'status',
  'priority',
  'source',
  'businessMode',
  'operationalStatus',
  'businessContext',
  'assignedUserId',
  'expectedCloseDate',
  'lostReason',
  'cardColor',
  'sortOrder',
  'visibility',
  'expectedVersion',
  'reasonCode',
];
crm('opportunity', 'GET', '/opportunities');
crm('opportunity', 'POST', '/opportunities', opportunity);
crm('opportunity', 'GET', '/opportunities/:id');
crm('opportunity', 'PATCH', '/opportunities/:id', opportunity);
crm('opportunity', 'PATCH', '/opportunities/reorder', ['opportunities']);
for (const [path, method, fields] of [
  [
    'stage',
    'PATCH',
    [
      'stageId',
      'expectedVersion',
      'reasonCode',
      'manualOverride',
      'manualOverrideReason',
    ],
  ],
  [
    'status',
    'PATCH',
    ['status', 'lostReason', 'expectedVersion', 'reasonCode'],
  ],
  ['card-color', 'PATCH', ['cardColor']],
  ['visibility', 'PATCH', ['visibility']],
  [
    'transfer',
    'POST',
    ['pipelineId', 'stageId', 'expectedVersion', 'reasonCode'],
  ],
  [
    'copy',
    'POST',
    ['pipelineId', 'stageId', 'title', 'expectedVersion', 'reasonCode'],
  ],
  [
    'reconvert',
    'POST',
    ['pipelineId', 'title', 'expectedVersion', 'reasonCode'],
  ],
  ['tags', 'POST', ['tagId']],
] as const)
  crm('opportunity', method, `/opportunities/:id/${path}`, fields);
for (const path of ['tags', 'events', 'lead-score'])
  crm('opportunity', 'GET', `/opportunities/:id/${path}`);
add(
  'leadflow_crm',
  'contact',
  'GET',
  '/agency/contacts/leadflow/company-contacts',
);
add(
  'leadflow_crm',
  'contact',
  'POST',
  '/agency/contacts/leadflow/company-contacts',
  [
    'type',
    'displayName',
    'email',
    'phone',
    'phoneLabel',
    'website',
    'instagramUsername',
    'facebookProfile',
    'tiktokUsername',
    'documentType',
    'documentNumber',
    'address',
    'clientId',
    'clientName',
  ],
);
add(
  'leadflow_crm',
  'contact',
  'GET',
  '/agency/contacts/leadflow/company-contacts/:contactId',
);
add(
  'leadflow_crm',
  'contact',
  'PATCH',
  '/agency/contacts/leadflow/company-contacts/:contactId',
  [
    'type',
    'displayName',
    'firstName',
    'lastName',
    'legalName',
    'documentType',
    'documentNumber',
    'jobTitle',
    'status',
    'notes',
  ],
);
add(
  'leadflow_crm',
  'contact-list',
  'GET',
  '/agency/contacts/leadflow/company-list',
);
const appointment = [
  'type',
  'status',
  'priority',
  'title',
  'description',
  'notes',
  'startAt',
  'endAt',
  'dueAt',
  'allDay',
  'timezone',
  'locationType',
  'locationText',
  'videoMode',
  'videoUrl',
  'phoneUrl',
  'visibility',
  'ownerUserId',
  'assignedUserId',
  'contactId',
  'sourceChannel',
  'sourceConversationId',
  'sourceOpportunityId',
];
const agenda = (
  kind: LeadFlowClientKind,
  method: string,
  path: string,
  fields?: readonly string[],
) =>
  add(
    'leadflow_appointments',
    kind,
    method,
    `/leadflow/agenda/v1${path}`,
    fields,
  );
agenda('agenda', 'GET', '/items');
agenda('appointment', 'GET', '/appointments');
agenda('appointment', 'POST', '/appointments', appointment);
agenda('appointment', 'GET', '/appointments/:id');
agenda('appointment', 'PATCH', '/appointments/:id', appointment);
agenda('appointment', 'PATCH', '/appointments/:id/lifecycle-status', [
  'status',
  'reason',
  'confirmedVia',
]);
agenda('participant', 'GET', '/appointments/:id/participants');
agenda('participant', 'POST', '/appointments/:id/participants', [
  'participantType',
  'userId',
  'contactId',
  'externalName',
  'externalEmail',
  'externalPhone',
  'responseStatus',
]);
agenda(
  'participant',
  'PATCH',
  '/appointments/:id/participants/:participantId/response',
  ['responseStatus'],
);
agenda('reminder', 'GET', '/appointments/:id/reminders');
agenda('reminder', 'POST', '/appointments/:id/reminders', [
  'reminderType',
  'offsetMinutes',
  'scheduledAt',
]);
agenda('reminder', 'POST', '/appointments/:id/reminders/:reminderId/cancel');
const agent = (
  kind: LeadFlowClientKind,
  method: string,
  path: string,
  fields?: readonly string[],
) => add('leadflow_agents', kind, method, `/leadflow/agents${path}`, fields);
agent('agent', 'GET', '');
agent('agent', 'GET', '/:id');
agent('preset', 'GET', '/presets');
agent('agent', 'POST', '/provision', [
  'presetKey',
  'type',
  'name',
  'description',
  'behaviorConfig',
  'avatarConfig',
  'activate',
]);
agent('agent', 'PATCH', '/:id', [
  'name',
  'type',
  'description',
  'behaviorConfig',
  'handoffPolicy',
  'crmPolicy',
  'channelPolicy',
  'avatarConfig',
]);
for (const action of ['activate', 'pause', 'publish', 'archive', 'unarchive'])
  agent('agent', 'POST', `/:id/${action}`);

/** Closed method+template contract. Controller opt-ins and frontend transport must match this table. */
export const LEADFLOW_CLIENT_AREA_ROUTES: readonly LeadFlowClientRoute[] =
  Object.freeze(routes);
export function leadFlowClientAreaRoute(method: string, path: string) {
  return LEADFLOW_CLIENT_AREA_ROUTES.find(
    (route) =>
      route.method === method &&
      route.path === path.replace(/^\/api(?=\/)/, ''),
  );
}
