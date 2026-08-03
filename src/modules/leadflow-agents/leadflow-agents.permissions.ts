/**
 * Permission keys for the LeadFlow Agents module. These follow the platform
 * convention `product.module.resource.action.scope` (see permission-keys
 * catalog). Some keys already existed in the catalog and are reused here; the
 * new ones are added to the catalog and seeded via migration.
 */
export const LEADFLOW_AGENTS_PERMISSIONS = {
  /** leadflow.agents.agent.view.client */
  view: 'leadflow.agents.agent.view.client',
  /** leadflow.agents.agent.configure.admin */
  manage: 'leadflow.agents.agent.configure.admin',
  /** leadflow.agents.agent.activate.admin */
  activate: 'leadflow.agents.agent.activate.admin',
  /** leadflow.agents.agent.deactivate.admin */
  pause: 'leadflow.agents.agent.deactivate.admin',
  /** leadflow.agents.agent.publish.admin (new) */
  publish: 'leadflow.agents.agent.publish.admin',
  /** leadflow.agents.channel.manage.admin (new) */
  channelManage: 'leadflow.agents.channel.manage.admin',
  /** leadflow.agents.runtime.preview.admin (new) */
  runtimePreview: 'leadflow.agents.runtime.preview.admin',
  /** leadflow.agents.developer.manage.owner_only (new) */
  developerManage: 'leadflow.agents.developer.manage.owner_only',
  /** leadflow.agents.agent.delete.owner_only (already seeded, now wired) */
  delete: 'leadflow.agents.agent.delete.owner_only',
} as const;

/** New keys introduced by this sprint (added to catalog + seeded). */
export const LEADFLOW_AGENTS_NEW_PERMISSION_KEYS: string[] = [
  LEADFLOW_AGENTS_PERMISSIONS.publish,
  LEADFLOW_AGENTS_PERMISSIONS.channelManage,
  LEADFLOW_AGENTS_PERMISSIONS.runtimePreview,
  LEADFLOW_AGENTS_PERMISSIONS.developerManage,
];

/** All agent keys seeded by this sprint (pre-existing + new). */
export const LEADFLOW_AGENTS_ALL_PERMISSION_KEYS: string[] = [
  'leadflow.agents.agent.view.client',
  'leadflow.agents.agent.use.client',
  'leadflow.agents.agent.configure.admin',
  'leadflow.agents.agent.activate.admin',
  'leadflow.agents.agent.deactivate.admin',
  'leadflow.agents.agent.delete.owner_only',
  'leadflow.agents.system.manage.owner_only',
  ...LEADFLOW_AGENTS_NEW_PERMISSION_KEYS,
];
