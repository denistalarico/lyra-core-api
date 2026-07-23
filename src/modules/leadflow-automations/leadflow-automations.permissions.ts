/**
 * Permission keys for the LeadFlow Automations module. They follow the platform
 * convention `product.module.resource.action.scope`. `view` reuses the key that
 * already existed in the catalog; the remaining keys are introduced by this
 * sprint (added to the catalog and seeded via migration).
 */
export const LEADFLOW_AUTOMATIONS_PERMISSIONS = {
  /** leadflow.automations.automation.view.client (pre-existing) */
  view: 'leadflow.automations.automation.view.client',
  /** leadflow.automations.automation.configure.admin (new) */
  configure: 'leadflow.automations.automation.configure.admin',
  /** leadflow.automations.automation.activate.admin (new) */
  activate: 'leadflow.automations.automation.activate.admin',
  /** leadflow.automations.automation.pause.admin (new) */
  pause: 'leadflow.automations.automation.pause.admin',
  /** leadflow.automations.automation.publish.admin (new) */
  publish: 'leadflow.automations.automation.publish.admin',
  /** leadflow.automations.developer.manage.owner_only (new) */
  developerManage: 'leadflow.automations.developer.manage.owner_only',
  /** leadflow.automations.logs.view.admin (new) */
  logsView: 'leadflow.automations.logs.view.admin',
  /** leadflow.automations.runtime.preview.admin (new) */
  runtimePreview: 'leadflow.automations.runtime.preview.admin',
  /** Execute a published effect, still subject to the owning domain permission. */
  execute: 'leadflow.automations.execution.execute.admin',
} as const;

/** New keys introduced by this sprint (added to catalog + seeded). */
export const LEADFLOW_AUTOMATIONS_NEW_PERMISSION_KEYS: string[] = [
  LEADFLOW_AUTOMATIONS_PERMISSIONS.configure,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.activate,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.pause,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.publish,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.developerManage,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.logsView,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.runtimePreview,
  LEADFLOW_AUTOMATIONS_PERMISSIONS.execute,
];

/** All automations keys seeded by this sprint (pre-existing view + new). */
export const LEADFLOW_AUTOMATIONS_ALL_PERMISSION_KEYS: string[] = [
  LEADFLOW_AUTOMATIONS_PERMISSIONS.view,
  ...LEADFLOW_AUTOMATIONS_NEW_PERMISSION_KEYS,
];
