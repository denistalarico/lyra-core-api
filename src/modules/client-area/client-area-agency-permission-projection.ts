import type {
  ClientAreaAccessLevel,
  ClientAreaModuleKey,
  ClientAreaMemberAccess,
} from './client-area.types';

export type ClientAreaAgencyGrant = {
  key: string;
  methods: readonly string[];
  scope: 'client' | 'created_by_me';
  cost?: 'ai' | 'media';
};
const read = ['GET', 'HEAD'];
const grant = (
  key: string,
  methods: readonly string[],
  scope: ClientAreaAgencyGrant['scope'] = 'client',
): ClientAreaAgencyGrant => ({ key, methods, scope });

const writes = ['POST', 'PATCH', 'PUT', 'DELETE'];
/** CA11 — module levels never expand through the Agency role/Owner path. */
function projectLeadFlowPermissions(
  module: ClientAreaModuleKey,
  level: ClientAreaAccessLevel,
): readonly ClientAreaAgencyGrant[] {
  const own = level === 'operator' ? 'created_by_me' : 'client';
  if (module === 'leadflow_inbox') {
    const reads = [
      grant('leadflow.channels.channel.view.client', read),
      grant('leadflow.inbox.conversation.view.client', read),
      grant('leadflow.inbox.comment.view.client', read),
    ];
    if (level === 'viewer') return reads;
    return [
      ...reads,
      grant('leadflow.inbox.conversation.reply.client', ['POST'], own),
      grant(
        'leadflow.inbox.conversation.assign.client',
        ['POST', 'PATCH'],
        own,
      ),
      grant('leadflow.inbox.conversation.close.client', ['POST'], own),
      grant('leadflow.inbox.conversation.view.client', ['POST'], own),
      // IX3: comments have no assignment, so the operator's grant is
      // company-wide. Deleting is a Danger Zone route: the guard lets it
      // through only for the company's Owner (`client_owner`), at any level.
      grant('leadflow.inbox.comment.reply.client', ['POST']),
      grant('leadflow.inbox.comment.delete.admin', ['DELETE']),
      ...(level === 'manager'
        ? [
            // PATCH: quick replies (`/inbox/settings`); POST/DELETE as well
            // for the company's follow-up templates (IX2). The bridge route
            // table still decides which routes may carry it.
            grant('leadflow.settings.general.update.admin', [
              'PATCH',
              'POST',
              'DELETE',
            ]),
          ]
        : []),
    ];
  }
  if (module === 'leadflow_crm') {
    const reads = [
      grant('leadflow.crm.records.view.client', read),
      grant('shared.contacts.view.client', read),
    ];
    if (level === 'viewer') return reads;
    return [
      ...reads,
      grant('leadflow.crm.records.create.client', ['POST']),
      grant('shared.contacts.create', ['POST']),
      grant('leadflow.crm.records.update.client', ['PATCH', 'POST'], own),
      grant('shared.contacts.update.client', ['PATCH'], own),
      ...(level === 'manager'
        ? [
            grant('leadflow.crm.pipeline.manage.admin', ['POST', 'PATCH']),
            grant('leadflow.crm.stage.manage.manager_or_admin', [
              'POST',
              'PATCH',
            ]),
          ]
        : []),
    ];
  }
  if (module === 'leadflow_appointments') {
    const reads = [grant('leadflow.appointments.item.view.client', read)];
    return level === 'viewer'
      ? reads
      : [
          ...reads,
          grant('leadflow.appointments.item.create.client', ['POST']),
          grant(
            'leadflow.appointments.item.update.client',
            ['PATCH', 'POST'],
            own,
          ),
        ];
  }
  if (module === 'leadflow_agents') {
    const reads = [
      grant('leadflow.agents.agent.view.client', read),
      // OR3: the Operations Room chat KPIs; only the two exposed analytics
      // routes carry this key on the bridge.
      grant('leadflow.analytics.reports.view.operational', read),
    ];
    return level !== 'manager'
      ? reads
      : [
          ...reads,
          ...['configure', 'activate', 'deactivate', 'publish'].map((action) =>
            grant(`leadflow.agents.agent.${action}.admin`, ['POST', 'PATCH']),
          ),
          // OR3: listing the room proposals (`GET room/actions`) is part of
          // acting on them, as in the Agency; no other exposed GET uses it.
          grant('leadflow.agents.agent.configure.admin', read),
          // CA11.1: only the exposed binding route carries this key; the scope adapter
          // requires an explicit company channel and agent (never the workspace sweep).
          grant('leadflow.channels.channel.update.admin', ['POST']),
        ];
  }
  return [];
}
/** CA10 — §3.3 Planner (with publishing and media), Studio and Campaigns rows. Manager-only and
 * cost-bearing routes sharing a key with ordinary writes are narrowed by the Social scope adapter;
 * keys used only by media-spend routes carry `cost` here. Planner/Studio deletes stay unexposed. */
function projectSocialPermissions(
  module: ClientAreaModuleKey,
  level: ClientAreaAccessLevel,
): readonly ClientAreaAgencyGrant[] {
  const own = level === 'operator' ? 'created_by_me' : 'client';
  if (module === 'social_planner') {
    const reads = [
      grant('social.planner.calendar.view.client', read),
      grant('social.campaigns.campaign.view.client', read),
      grant('social.publishing.publication.view.assigned', read),
      grant('social.publishing.media.view.assigned', read),
    ];
    if (level === 'viewer') return reads;
    const operator = [
      ...reads,
      grant('social.planner.calendar.create.manager', ['POST']),
      grant('social.planner.calendar.update.manager', writes, own),
      grant('social.publishing.media.upload.manager', ['POST']),
    ];
    if (level === 'operator') return operator;
    return [
      ...operator,
      grant('social.campaigns.campaign.create.manager', ['POST']),
      grant('social.campaigns.campaign.update.manager', ['PATCH']),
      grant('social.publishing.publication.create.manager', ['POST']),
      grant('social.publishing.publication.publish_now.manager', [
        'POST',
        'PATCH',
      ]),
      grant('social.publishing.publication.cancel.manager', ['POST']),
    ];
  }
  if (module === 'social_creative_studio') {
    const reads = [
      grant('social.creative.content.view.assigned', read),
      grant('social.brandkit.asset.view.client', read),
    ];
    if (level === 'viewer') return reads;
    return [
      ...reads,
      ...(level === 'manager'
        ? [
            grant('social.brandkit.assets.manage.manager_or_admin', [
              'POST',
              'PATCH',
            ]),
          ]
        : []),
      grant('social.creative.content.create_draft.assigned', ['POST']),
      grant('social.creative.content.update.assigned', ['POST', 'PATCH'], own),
    ];
  }
  if (module === 'social_campaigns') {
    const reads = [
      grant('social.ads.campaign.view.client', read),
      grant('social.analytics.reports.view.operational', read),
    ];
    if (level !== 'manager') return reads;
    const media = (key: string): ClientAreaAgencyGrant => ({
      ...grant(key, ['POST']),
      cost: 'media',
    });
    return [
      ...reads,
      grant('social.ads.campaign.manage.admin_or_explicit', ['POST', 'PATCH']),
      media('social.ads.status.execute.admin_or_explicit'),
      media('social.ads.budget.execute.admin_or_explicit'),
      media('social.ads.schedule.execute.admin_or_explicit'),
    ];
  }
  return [];
}

/** Explicit, method-bound grants: several existing Projects routes reuse a key for reads and writes.
 * CA10/CA11 append audited product projections here; no wildcard/Agency Owner expansion. */
export function projectAgencyPermissions(
  module: ClientAreaModuleKey,
  level: ClientAreaAccessLevel | null,
): readonly ClientAreaAgencyGrant[] {
  if (!level) return [];
  if (module === 'analytics')
    return [grant('agency.dashboards.view.agency', read)];
  if (module.startsWith('leadflow_'))
    return projectLeadFlowPermissions(module, level);
  if (module !== 'agency_projects')
    return projectSocialPermissions(module, level);
  const reads = [
    grant('agency.projects.project.view.assigned', read),
    grant('agency.tasks.task.update.assigned', read),
    grant('agency.tasks.task.manage.department', read),
  ];
  if (level === 'viewer') return reads;
  const operator = [
    ...reads,
    grant('agency.tasks.task.create.assigned', ['POST']),
    grant('agency.tasks.task.update.assigned', ['PATCH', 'PUT', 'POST']),
    grant(
      'agency.tasks.task.update.assigned',
      ['DELETE'],
      level === 'operator' ? 'created_by_me' : 'client',
    ),
    grant(
      'agency.tasks.task.manage.department',
      ['DELETE'],
      level === 'operator' ? 'created_by_me' : 'client',
    ),
  ];
  if (level === 'operator') return operator;
  return [
    ...operator,
    grant('agency.tasks.task.manage.department', ['POST', 'PATCH', 'PUT']),
    grant('agency.projects.project.create.department', ['POST']),
    grant('agency.projects.project.update.department', [
      'PATCH',
      'PUT',
      'POST',
    ]),
    grant('agency.projects.project.archive.own', ['DELETE', 'POST', 'PATCH']),
    grant('agency.projects.project.archive.department', [
      'DELETE',
      'POST',
      'PATCH',
    ]),
  ];
}

/** Mutation keys reused by read endpoints must not advertise editing rights to a Viewer. */
export function clientAreaUiPermissions(
  access: ClientAreaMemberAccess,
): string[] {
  const keys = new Set<string>();
  for (const [module, state] of Object.entries(access)) {
    if (!state.available) continue;
    for (const entry of projectAgencyPermissions(
      module as ClientAreaModuleKey,
      state.level,
    )) {
      if (state.level !== 'viewer' || entry.key.includes('.view.'))
        keys.add(entry.key);
    }
  }
  return [...keys].sort();
}
