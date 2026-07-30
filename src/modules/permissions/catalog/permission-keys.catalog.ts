import {
  PermissionRiskLevel,
  PlatformRoleKey,
} from '../enums/permission.enums';

/**
 * Permission key format (blueprint section 6.8):
 *   product.module.resource.action.scope
 *
 * Not every key has an explicit scope segment (e.g. `agency.sales.contacts.create`).
 * In that case `scopeKey` is `null` and the action applies regardless of scope.
 */
export interface PermissionDefinition {
  key: string;
  productKey: string;
  moduleKey: string;
  resourceKey: string;
  actionKey: string;
  scopeKey: string | null;
  /** Default roles that hold this permission out of the box. Owner always implied. */
  roles: PlatformRoleKey[];
  isDangerous: boolean;
  riskLevel: PermissionRiskLevel;
}

const { Owner, Admin, Manager, Member } = PlatformRoleKey;

const ALL_ROLES = [Member, Manager, Admin, Owner];
const MANAGER_UP = [Manager, Admin, Owner];
const ADMIN_UP = [Admin, Owner];
const OWNER_ONLY = [Owner];

type RawPermission = [
  key: string,
  roles: PlatformRoleKey[],
  dangerous?: boolean,
];

function resolveRiskLevel(
  roles: PlatformRoleKey[],
  dangerous: boolean,
): PermissionRiskLevel {
  if (dangerous) {
    return roles.length === 1
      ? PermissionRiskLevel.Critical
      : PermissionRiskLevel.High;
  }

  if (roles.includes(Member)) {
    return PermissionRiskLevel.Low;
  }

  if (roles.includes(Manager)) {
    return PermissionRiskLevel.Medium;
  }

  return PermissionRiskLevel.High;
}

function buildDefinition([
  key,
  roles,
  dangerous = false,
]: RawPermission): PermissionDefinition {
  const segments = key.split('.');
  const [productKey, moduleKey, ...rest] = segments;

  if (productKey === 'shared' && moduleKey === 'contacts') {
    const [actionKey, ...scopeSegments] = rest;

    return {
      key,
      productKey,
      moduleKey,
      resourceKey: 'contact',
      actionKey,
      scopeKey: scopeSegments.length > 0 ? scopeSegments.join('_') : null,
      roles,
      isDangerous: dangerous,
      riskLevel: resolveRiskLevel(roles, dangerous),
    };
  }

  // Last segment is treated as the scope when there are at least
  // resource + action + scope (i.e. 3+ remaining segments).
  const scopeKey = rest.length >= 3 ? rest[rest.length - 1] : null;
  const actionSegments = scopeKey ? rest.slice(0, -1) : rest;
  const resourceKey = actionSegments.slice(0, -1).join('.');
  const actionKey = actionSegments[actionSegments.length - 1];

  return {
    key,
    productKey,
    moduleKey,
    resourceKey,
    actionKey,
    scopeKey,
    roles,
    isDangerous: dangerous,
    riskLevel: resolveRiskLevel(roles, dangerous),
  };
}

/**
 * Default permission catalog and Owner/Admin/Manager/Member matrix,
 * derived from the Lyra Platform Permissions Blueprint (sections 9, 10 and 11).
 *
 * Owner implicitly has every permission (see PlatformPermissionService) and is
 * not listed individually below for brevity, except where it is the only role.
 */
const RAW_PERMISSIONS: RawPermission[] = [
  // Shared domains - Contacts
  ['shared.contacts.view.assigned', ALL_ROLES],
  ['shared.contacts.view.client', MANAGER_UP],
  ['shared.contacts.view.department', MANAGER_UP],
  ['shared.contacts.view.all', ADMIN_UP],
  ['shared.contacts.create', ALL_ROLES],
  ['shared.contacts.update.assigned', ALL_ROLES],
  ['shared.contacts.update.client', MANAGER_UP],
  ['shared.contacts.import.admin', ADMIN_UP],
  ['shared.contacts.export.admin', ADMIN_UP, true],
  ['shared.contacts.merge.admin', ADMIN_UP, true],
  ['shared.contacts.delete.owner_only', OWNER_ONLY, true],

  // 9.1 Dashboards
  ['agency.dashboards.view.self', ALL_ROLES],
  ['agency.dashboards.view.department', MANAGER_UP],
  ['agency.dashboards.view.agency', ADMIN_UP],
  ['agency.dashboards.view.executive', OWNER_ONLY],

  // 9.2 Team Chat
  ['agency.chat.channels.view.assigned', ALL_ROLES],
  ['agency.chat.messages.send.assigned', ALL_ROLES],
  ['agency.chat.channels.manage_members.assigned', MANAGER_UP],
  ['agency.chat.channels.create.department', MANAGER_UP],
  ['agency.chat.channels.archive.all', ADMIN_UP],
  ['agency.chat.channels.delete.owner_only', OWNER_ONLY, true],

  // 9.3 Projects e Tasks
  ['agency.projects.project.view.assigned', ALL_ROLES],
  ['agency.projects.project.create.department', MANAGER_UP],
  ['agency.projects.project.update.department', MANAGER_UP],
  ['agency.projects.project.archive.own', MANAGER_UP],
  ['agency.projects.project.archive.department', MANAGER_UP],
  ['agency.projects.project.delete.owner_only', OWNER_ONLY, true],
  ['agency.projects.stages.manage.admin', MANAGER_UP],
  ['agency.tasks.task.create.assigned', ALL_ROLES],
  ['agency.tasks.task.update.assigned', ALL_ROLES],
  ['agency.tasks.task.manage.department', MANAGER_UP],
  ['agency.tasks.time.track.self', ALL_ROLES],

  // 9.4 Calendar
  ['agency.calendar.events.view.self', ALL_ROLES],
  ['agency.calendar.events.manage.self', ALL_ROLES],
  ['agency.calendar.events.view.department', MANAGER_UP],
  ['agency.calendar.events.manage.department', MANAGER_UP],
  ['agency.calendar.events.view.all', ADMIN_UP],
  ['agency.calendar.settings.manage.admin', ADMIN_UP],

  // 9.5 Knowledge
  ['agency.knowledge.articles.view.published', ALL_ROLES],
  ['agency.knowledge.articles.comment', ALL_ROLES],
  ['agency.knowledge.wall.post', ALL_ROLES],
  ['agency.knowledge.articles.create.department', MANAGER_UP],
  ['agency.knowledge.articles.publish.department', MANAGER_UP],
  ['agency.knowledge.categories.manage.admin', ADMIN_UP],
  ['agency.knowledge.articles.delete.owner_only', OWNER_ONLY, true],

  // 9.6 Clients
  ['agency.clients.profile.view.basic.assigned', MANAGER_UP],
  ['agency.clients.profile.view.relationship.assigned', MANAGER_UP],
  ['agency.clients.profile.view.business.admin', ADMIN_UP],
  ['agency.clients.profile.create.admin', ADMIN_UP],
  ['agency.clients.profile.update.assigned', MANAGER_UP],
  ['agency.clients.profile.archive.admin', ADMIN_UP],
  ['agency.clients.profile.delete.owner_only', OWNER_ONLY, true],
  ['agency.clients.profitability.view.owner_or_finance', OWNER_ONLY],
  ['agency.clients.products.view.assigned', MANAGER_UP],
  ['agency.clients.products.manage.admin', ADMIN_UP],
  ['agency.clients.managed_tenant.view.admin', ADMIN_UP],
  ['agency.clients.managed_tenant.manage.owner_only', OWNER_ONLY, true],
  ['agency.clients.lifecycle.view.assigned', MANAGER_UP],
  ['agency.clients.lifecycle.manage.assigned', MANAGER_UP],
  ['agency.clients.lifecycle.settings.manage.admin', ADMIN_UP],

  // 9.7 Sales
  ['agency.sales.contacts.create', ALL_ROLES],
  ['agency.sales.contacts.update.assigned', ALL_ROLES],
  ['agency.sales.crm.view.assigned', ALL_ROLES],
  ['agency.sales.crm.view.department', MANAGER_UP],
  ['agency.sales.crm.manage.department', MANAGER_UP],
  ['agency.sales.pipeline.manage.admin', ADMIN_UP],
  ['agency.sales.stages.manage.manager_or_admin', MANAGER_UP],
  ['agency.sales.quotes.create', ALL_ROLES],
  ['agency.sales.quotes.approve.department', MANAGER_UP],
  ['agency.sales.products.manage.admin', ADMIN_UP],
  ['agency.sales.plans.manage.admin', ADMIN_UP],

  // 9.8 Finance
  ['agency.finance.summary.view.finance_or_owner', ADMIN_UP],
  ['agency.finance.transactions.view.finance_or_owner', ADMIN_UP],
  ['agency.finance.transactions.manage.finance_or_owner', OWNER_ONLY],
  ['agency.finance.reports.view.finance_or_owner', ADMIN_UP],
  ['agency.finance.profitability.view.finance_or_owner', OWNER_ONLY],
  ['agency.finance.settings.manage.admin_or_owner', ADMIN_UP],
  ['agency.finance.fiscal.manage.owner_only', OWNER_ONLY, true],
  ['agency.finance.billing.manage.owner_only', OWNER_ONLY, true],

  // 9.9 Team
  ['agency.team.directory.view.all_members', ALL_ROLES],
  ['agency.team.member.view.self', ALL_ROLES],
  ['agency.team.member.update.self', ALL_ROLES],
  ['agency.team.member.view.department', MANAGER_UP],
  ['agency.team.member.update.department', MANAGER_UP],
  ['agency.team.structure.manage.admin', ADMIN_UP],
  ['agency.team.structure.delete.owner_only', OWNER_ONLY, true],
  ['agency.team.attendance.view.self', ALL_ROLES],
  ['agency.team.attendance.view.department', MANAGER_UP],
  ['agency.team.attendance.approve.department', MANAGER_UP],
  ['agency.team.contracts.view.hr_or_owner', OWNER_ONLY],
  ['agency.team.compensation.view.owner_or_hr', OWNER_ONLY],
  ['agency.team.users.invite.admin', ADMIN_UP],
  ['agency.team.users.deactivate.admin', ADMIN_UP],
  ['agency.team.users.delete.owner_only', OWNER_ONLY, true],

  // 9.10 Contracts
  ['agency.contracts.view.assigned', MANAGER_UP],
  ['agency.contracts.create.from_template', MANAGER_UP],
  ['agency.contracts.send_signature.manager_or_admin', MANAGER_UP],
  ['agency.contracts.templates.manage.admin', ADMIN_UP],
  ['agency.contracts.archive.admin', ADMIN_UP],
  ['agency.contracts.delete.owner_only', OWNER_ONLY, true],
  ['agency.contracts.integrations.manage.owner_only', OWNER_ONLY, true],

  // 9.11 Settings
  ['agency.settings.account.view.self', ALL_ROLES],
  ['agency.settings.account.update.self', ALL_ROLES],
  ['agency.settings.company.view.admin', ADMIN_UP],
  ['agency.settings.company.update.admin', ADMIN_UP],
  ['agency.settings.users.manage.admin', ADMIN_UP],
  ['agency.settings.permissions.manage.admin', ADMIN_UP],
  ['agency.settings.integrations.manage.admin', ADMIN_UP],
  ['agency.settings.email.manage.admin', ADMIN_UP],
  ['agency.settings.apps.manage.admin', ADMIN_UP],
  ['agency.settings.billing.view.owner_only', OWNER_ONLY],
  ['agency.settings.billing.manage.owner_only', OWNER_ONLY, true],
  ['agency.settings.domains.manage.owner_only', OWNER_ONLY, true],
  ['agency.settings.danger_zone.manage.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - Inbox
  ['leadflow.inbox.conversation.view.assigned', ALL_ROLES],
  ['leadflow.inbox.conversation.view.client', MANAGER_UP],
  ['leadflow.inbox.conversation.view.all', ADMIN_UP],
  ['leadflow.inbox.conversation.reply.assigned', ALL_ROLES],
  ['leadflow.inbox.conversation.reply.client', MANAGER_UP],
  ['leadflow.inbox.conversation.assign.client', MANAGER_UP],
  ['leadflow.inbox.conversation.close.assigned', ALL_ROLES],
  ['leadflow.inbox.conversation.close.client', MANAGER_UP],
  ['leadflow.inbox.conversation.export.admin', ADMIN_UP],
  ['leadflow.inbox.conversation.delete.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - Channels
  ['leadflow.channels.channel.view.client', MANAGER_UP],
  ['leadflow.channels.channel.manage_members.client', MANAGER_UP],
  ['leadflow.channels.channel.create.admin', ADMIN_UP],
  ['leadflow.channels.channel.update.admin', ADMIN_UP],
  ['leadflow.channels.channel.disconnect.owner_or_explicit', OWNER_ONLY, true],
  ['leadflow.channels.channel.delete.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - CRM
  ['leadflow.crm.records.view.assigned', ALL_ROLES],
  ['leadflow.crm.records.view.client', MANAGER_UP],
  ['leadflow.crm.records.create.client', ALL_ROLES],
  ['leadflow.crm.records.update.assigned', ALL_ROLES],
  ['leadflow.crm.records.update.client', MANAGER_UP],
  ['leadflow.crm.pipeline.manage.admin', ADMIN_UP],
  ['leadflow.crm.stage.manage.manager_or_admin', MANAGER_UP],
  ['leadflow.crm.records.delete.owner_or_admin_explicit', OWNER_ONLY, true],

  // 10.5 LeadFlow - Agents
  ['leadflow.agents.agent.view.client', MANAGER_UP],
  ['leadflow.agents.agent.use.client', ALL_ROLES],
  ['leadflow.agents.agent.configure.admin', ADMIN_UP],
  ['leadflow.agents.agent.activate.admin', ADMIN_UP],
  ['leadflow.agents.agent.deactivate.admin', ADMIN_UP],
  ['leadflow.agents.agent.publish.admin', ADMIN_UP],
  ['leadflow.agents.channel.manage.admin', ADMIN_UP],
  ['leadflow.agents.runtime.preview.admin', ADMIN_UP],
  ['leadflow.agents.agent.delete.owner_only', OWNER_ONLY, true],
  ['leadflow.agents.developer.manage.owner_only', OWNER_ONLY, true],
  ['leadflow.agents.system.manage.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - Automations
  ['leadflow.automations.automation.view.client', MANAGER_UP],
  ['leadflow.automations.automation.use_template.manager', MANAGER_UP],
  ['leadflow.automations.automation.create.admin', ADMIN_UP],
  ['leadflow.automations.automation.update.admin', ADMIN_UP],
  ['leadflow.automations.automation.pause.manager_or_admin', MANAGER_UP],
  [
    'leadflow.automations.automation.delete.owner_or_admin_explicit',
    OWNER_ONLY,
    true,
  ],
  // Automations Recipes & Rules Contract sprint (config-only)
  ['leadflow.automations.automation.configure.admin', ADMIN_UP],
  ['leadflow.automations.automation.activate.admin', ADMIN_UP],
  ['leadflow.automations.automation.pause.admin', ADMIN_UP],
  ['leadflow.automations.automation.publish.admin', ADMIN_UP],
  ['leadflow.automations.logs.view.admin', ADMIN_UP],
  ['leadflow.automations.runtime.preview.admin', ADMIN_UP],
  ['leadflow.automations.execution.execute.admin', ADMIN_UP],
  ['leadflow.automations.developer.manage.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - Event Contract (contract-only, sem runtime)
  ['leadflow.events.catalog.view', MANAGER_UP],
  ['leadflow.events.validate.admin', ADMIN_UP],
  ['leadflow.events.runtime.preview.admin', ADMIN_UP],
  ['leadflow.events.developer.manage.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - Analytics
  ['leadflow.analytics.reports.view.operational', MANAGER_UP],
  ['leadflow.analytics.reports.view.full', ADMIN_UP],
  ['leadflow.analytics.reports.export.admin', ADMIN_UP],
  ['leadflow.analytics.recommendations.manage.admin', ADMIN_UP],

  // 10.5 LeadFlow - Settings
  ['leadflow.settings.general.view.admin', ADMIN_UP],
  ['leadflow.settings.general.update.admin', ADMIN_UP],
  ['leadflow.settings.integrations.manage.admin', ADMIN_UP],
  ['leadflow.settings.permissions.manage.admin', ADMIN_UP],
  ['leadflow.settings.telemetry.view.admin', ADMIN_UP],
  ['leadflow.settings.telemetry.manage.owner_only', OWNER_ONLY, true],
  ['leadflow.settings.danger_zone.manage.owner_only', OWNER_ONLY, true],

  // 10.5 LeadFlow - Appointments
  ['leadflow.appointments.item.view.assigned', ALL_ROLES],
  ['leadflow.appointments.item.view.client', MANAGER_UP],
  ['leadflow.appointments.item.create.client', ALL_ROLES],
  ['leadflow.appointments.item.update.assigned', ALL_ROLES],
  ['leadflow.appointments.item.update.client', MANAGER_UP],
  ['leadflow.appointments.item.delete.owner_only', OWNER_ONLY, true],

  // 11.5 Social - Planner
  ['social.planner.calendar.view.assigned', ALL_ROLES],
  ['social.planner.calendar.view.client', MANAGER_UP],
  ['social.planner.calendar.create.manager', MANAGER_UP],
  ['social.planner.calendar.update.manager', MANAGER_UP],
  ['social.planner.calendar.delete.owner_or_admin_explicit', OWNER_ONLY, true],

  // 11.5 Social - Creative Studio
  ['social.creative.content.view.assigned', ALL_ROLES],
  ['social.creative.content.view.client', MANAGER_UP],
  ['social.creative.content.create_draft.assigned', ALL_ROLES],
  ['social.creative.content.update.assigned', ALL_ROLES],
  ['social.creative.content.submit_review.assigned', ALL_ROLES],
  ['social.creative.content.delete.owner_or_admin_explicit', OWNER_ONLY, true],

  // 11.5 Social - Campaigns & Ads
  ['social.campaigns.campaign.view.client', MANAGER_UP],
  ['social.campaigns.campaign.create.manager', MANAGER_UP],
  ['social.campaigns.campaign.update.manager', MANAGER_UP],
  ['social.campaigns.campaign.manage_status.manager', MANAGER_UP],
  [
    'social.campaigns.campaign.delete.owner_or_admin_explicit',
    OWNER_ONLY,
    true,
  ],
  ['social.ads.campaign.view.client', MANAGER_UP],
  ['social.ads.campaign.manage.admin_or_explicit', ADMIN_UP],

  // 11.5 Social - Approvals
  ['social.approvals.review.view.assigned', ALL_ROLES],
  ['social.approvals.review.comment.assigned', ALL_ROLES],
  ['social.approvals.review.request_changes.manager', MANAGER_UP],
  ['social.approvals.review.approve_internal.manager', MANAGER_UP],
  ['social.approvals.review.approve_final.admin_or_client', ADMIN_UP],
  [
    'social.approvals.review.override.owner_or_admin_explicit',
    OWNER_ONLY,
    true,
  ],

  // 11.5 Social - Brand Kit
  ['social.brandkit.asset.view.client', ALL_ROLES],
  ['social.brandkit.asset.update.manager_or_admin', MANAGER_UP],
  ['social.brandkit.asset.delete.owner_or_admin_explicit', OWNER_ONLY, true],
  ['social.brandkit.assets.manage.manager_or_admin', MANAGER_UP],

  // 11.5 Social - Analytics
  ['social.analytics.reports.view.operational', MANAGER_UP],
  ['social.analytics.reports.view.full', ADMIN_UP],
  ['social.analytics.reports.export.admin', ADMIN_UP],

  // 11.5 Social - Settings
  ['social.settings.general.view.admin', ADMIN_UP],
  ['social.settings.general.update.admin', ADMIN_UP],
  ['social.settings.integrations.manage.admin', ADMIN_UP],
  ['social.settings.permissions.manage.admin', ADMIN_UP],
  ['social.settings.danger_zone.manage.owner_only', OWNER_ONLY, true],
];

export const PERMISSION_DEFINITIONS: PermissionDefinition[] =
  RAW_PERMISSIONS.map(buildDefinition);

export const PERMISSION_KEYS = PERMISSION_DEFINITIONS.map(
  (definition) => definition.key,
);

export function isKnownPermissionKey(key: string): boolean {
  return PERMISSION_KEYS.includes(key);
}

export function getPermissionDefinition(
  key: string,
): PermissionDefinition | undefined {
  return PERMISSION_DEFINITIONS.find((definition) => definition.key === key);
}

export function getDangerousPermissionKeys(): string[] {
  return PERMISSION_DEFINITIONS.filter(
    (definition) => definition.isDangerous,
  ).map((definition) => definition.key);
}
