/**
 * Permission keys for the LeadFlow Event Contract module (blueprint section
 * 15). All keys are introduced by this sprint: added to the permission
 * catalog and seeded via migration.
 */
export const LEADFLOW_EVENTS_PERMISSIONS = {
  /** leadflow.events.catalog.view (new) */
  catalogView: 'leadflow.events.catalog.view',
  /** leadflow.events.validate.admin (new) */
  validate: 'leadflow.events.validate.admin',
  /** leadflow.events.runtime.preview.admin (new) */
  runtimePreview: 'leadflow.events.runtime.preview.admin',
  /** leadflow.events.developer.manage.owner_only (new) */
  developerManage: 'leadflow.events.developer.manage.owner_only',
} as const;

/** All event-contract keys seeded by this sprint. */
export const LEADFLOW_EVENTS_ALL_PERMISSION_KEYS: string[] = [
  LEADFLOW_EVENTS_PERMISSIONS.catalogView,
  LEADFLOW_EVENTS_PERMISSIONS.validate,
  LEADFLOW_EVENTS_PERMISSIONS.runtimePreview,
  LEADFLOW_EVENTS_PERMISSIONS.developerManage,
];
