/**
 * Coarse readiness state of an automation instance. Mirrors the blueprint
 * (section 9) — it explains *why* an automation is not ready to run, so the UI
 * can guide the user to the missing configuration.
 */
export enum LeadFlowAutomationReadinessState {
  Ready = 'ready',
  MissingSettings = 'missing_settings',
  MissingChannel = 'missing_channel',
  MissingAgent = 'missing_agent',
  MissingPermission = 'missing_permission',
  DeveloperRequired = 'developer_required',
  UnsupportedBusinessMode = 'unsupported_business_mode',
}
