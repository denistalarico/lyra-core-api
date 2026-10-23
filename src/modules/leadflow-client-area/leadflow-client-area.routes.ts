import type { ClientAreaModuleKey } from '../client-area/client-area.types';

export type LeadFlowClientKind =
  | 'channel'
  | 'conversation'
  | 'message'
  | 'media'
  | 'outbound'
  | 'settings'
  | 'followup-template'
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
};
const routes: LeadFlowClientRoute[] = [];
const add = (
  module: ClientAreaModuleKey,
  kind: LeadFlowClientKind,
  method: string,
  path: string,
) => routes.push({ module, kind, method, path });
const inbox = (kind: LeadFlowClientKind, method: string, path: string) =>
  add('leadflow_inbox', kind, method, `/inbox${path}`);
const crm = (kind: LeadFlowClientKind, method: string, path: string) =>
  add('leadflow_crm', kind, method, `/crm${path}`);
inbox('channel', 'GET', '/channels');
inbox('conversation', 'GET', '/conversations');
inbox('conversation', 'POST', '/conversations');
inbox('conversation', 'GET', '/conversations/:id');
inbox('conversation', 'PATCH', '/conversations/:id');
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
  inbox('conversation', 'POST', `/conversations/:id/${action}`);
inbox('message', 'GET', '/conversations/:id/messages');
// This resource writes notes only. External replies use the canonical channel outbox.
inbox('message', 'POST', '/conversations/:id/messages');
for (const action of ['reaction', 'pin', 'favorite'])
  inbox('message', 'POST', `/conversations/:id/messages/:messageId/${action}`);
inbox('media', 'GET', '/media/:mediaId/content');
inbox('settings', 'GET', '/settings');
inbox('settings', 'PATCH', '/settings');
// IX2: the company's Lyra follow-up templates, the conversation's messaging
// window and the one-click send of a pending manual step (as a person).
inbox('followup-template', 'GET', '/followup-templates');
inbox('followup-template', 'POST', '/followup-templates');
inbox('followup-template', 'PATCH', '/followup-templates/:id');
inbox('followup-template', 'DELETE', '/followup-templates/:id');
inbox('conversation', 'GET', '/conversations/:id/messaging-window');
inbox('conversation', 'POST', '/conversations/:id/followup/send');
for (const channel of ['whatsapp', 'instagram', 'facebook-messenger']) {
  inbox('outbound', 'POST', `/channels/${channel}/send-text`);
  inbox('outbound', 'POST', `/channels/${channel}/send-media`);
}
for (const [kind, path] of [
  ['pipeline', 'pipelines'],
  ['stage', 'stages'],
  ['tag', 'tags'],
] as const) {
  crm(kind, 'GET', `/${path}`);
  crm(kind, 'GET', `/${path}/:id`);
  crm(kind, 'POST', `/${path}`);
  crm(kind, 'PATCH', `/${path}/:id`);
}
crm('stage', 'PATCH', '/stages/reorder');
crm('stage', 'PATCH', '/stages/:id/fold');
for (const path of ['opportunity-fields', 'loss-reasons'])
  crm('catalog', 'GET', `/${path}`);
crm('opportunity', 'GET', '/opportunities');
crm('opportunity', 'POST', '/opportunities');
crm('opportunity', 'GET', '/opportunities/:id');
crm('opportunity', 'PATCH', '/opportunities/:id');
crm('opportunity', 'PATCH', '/opportunities/reorder');
for (const [path, method] of [
  ['stage', 'PATCH'],
  ['status', 'PATCH'],
  ['card-color', 'PATCH'],
  ['visibility', 'PATCH'],
  ['transfer', 'POST'],
  ['copy', 'POST'],
  ['reconvert', 'POST'],
  ['tags', 'POST'],
] as const)
  crm('opportunity', method, `/opportunities/:id/${path}`);
for (const path of ['tags', 'events', 'lead-score'])
  crm('opportunity', 'GET', `/opportunities/:id/${path}`);
const contacts = '/agency/contacts/leadflow';
add('leadflow_crm', 'contact', 'GET', `${contacts}/company-contacts`);
add('leadflow_crm', 'contact', 'POST', `${contacts}/company-contacts`);
add(
  'leadflow_crm',
  'contact',
  'GET',
  `${contacts}/company-contacts/:contactId`,
);
add(
  'leadflow_crm',
  'contact',
  'PATCH',
  `${contacts}/company-contacts/:contactId`,
);
add('leadflow_crm', 'contact-list', 'GET', `${contacts}/company-list`);
const agenda = (kind: LeadFlowClientKind, method: string, path: string) =>
  add('leadflow_appointments', kind, method, `/leadflow/agenda/v1${path}`);
agenda('agenda', 'GET', '/items');
agenda('appointment', 'GET', '/appointments');
agenda('appointment', 'POST', '/appointments');
agenda('appointment', 'GET', '/appointments/:id');
agenda('appointment', 'PATCH', '/appointments/:id');
agenda('appointment', 'PATCH', '/appointments/:id/lifecycle-status');
agenda('participant', 'GET', '/appointments/:id/participants');
agenda('participant', 'POST', '/appointments/:id/participants');
agenda(
  'participant',
  'PATCH',
  '/appointments/:id/participants/:participantId/response',
);
agenda('reminder', 'GET', '/appointments/:id/reminders');
agenda('reminder', 'POST', '/appointments/:id/reminders');
agenda('reminder', 'POST', '/appointments/:id/reminders/:reminderId/cancel');
const agent = (kind: LeadFlowClientKind, method: string, path: string) =>
  add('leadflow_agents', kind, method, `/leadflow/agents${path}`);
agent('agent', 'GET', '');
agent('agent', 'GET', '/:id');
agent('preset', 'GET', '/presets');
agent('agent', 'POST', '/provision');
agent('agent', 'PATCH', '/:id');
for (const action of ['activate', 'pause', 'publish', 'archive', 'unarchive'])
  agent('agent', 'POST', `/:id/${action}`);
// CA11.1: the agent page binds a company channel to an explicit agent (or clears it).
add('leadflow_agents', 'channel', 'POST', '/inbox/channels/bindings/reconcile');

/**
 * Closed method+template contract (D-02 item 8). Controller opt-ins and the frontend transport
 * must match this table. CA11.1 (D-02 revisada): no per-route field list — the Agency DTO
 * (ValidationPipe whitelist + forbidNonWhitelisted) is the only write contract and the domain
 * serializer the only read contract; the scope adapter proves company, level and authorship.
 */
export const LEADFLOW_CLIENT_AREA_ROUTES: readonly LeadFlowClientRoute[] =
  Object.freeze(routes);
export function leadFlowClientAreaRoute(method: string, path: string) {
  return LEADFLOW_CLIENT_AREA_ROUTES.find(
    (route) =>
      route.method === method &&
      route.path === path.replace(/^\/api(?=\/)/, ''),
  );
}
