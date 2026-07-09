/**
 * Product-level grouping of automation recipes. Categories drive the filter
 * chips in the UI and are copied onto each provisioned instance.
 */
export enum LeadFlowAutomationCategory {
  Followup = 'followup',
  Appointments = 'appointments',
  LeadSignals = 'lead_signals',
  Handoff = 'handoff',
  Availability = 'availability',
  DataQuality = 'data_quality',
  PostService = 'post_service',
  Retention = 'retention',
  Reporting = 'reporting',
  Routing = 'routing',
  Tagging = 'tagging',
  Feedback = 'feedback',
  Lifecycle = 'lifecycle',
  Documents = 'documents',
  Developer = 'developer',
}
