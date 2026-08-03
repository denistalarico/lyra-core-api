/**
 * Permission keys for the LeadFlow Briefing module (sources/extraction/
 * suggestions/provenance). All keys are new: added to the permission catalog
 * and seeded via migration. No controller enforces them yet (F4-001 has no
 * HTTP surface) — seeding now avoids a second permission migration in F4-004.
 */
export const LEADFLOW_BRIEFING_PERMISSIONS = {
  /** leadflow.briefing.sources.manage.admin (new) */
  sourcesManage: 'leadflow.briefing.sources.manage.admin',
  /** leadflow.briefing.jobs.manage.admin (new) */
  jobsManage: 'leadflow.briefing.jobs.manage.admin',
  /** leadflow.briefing.suggestions.review.admin (new) */
  suggestionsReview: 'leadflow.briefing.suggestions.review.admin',
  /** leadflow.briefing.suggestions.apply.admin (new) */
  suggestionsApply: 'leadflow.briefing.suggestions.apply.admin',
  /** leadflow.briefing.provenance.view.admin (new) */
  provenanceView: 'leadflow.briefing.provenance.view.admin',
} as const;

/** All LeadFlow Briefing keys seeded by this sprint. */
export const LEADFLOW_BRIEFING_ALL_PERMISSION_KEYS: string[] = [
  LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage,
  LEADFLOW_BRIEFING_PERMISSIONS.jobsManage,
  LEADFLOW_BRIEFING_PERMISSIONS.suggestionsReview,
  LEADFLOW_BRIEFING_PERMISSIONS.suggestionsApply,
  LEADFLOW_BRIEFING_PERMISSIONS.provenanceView,
];
