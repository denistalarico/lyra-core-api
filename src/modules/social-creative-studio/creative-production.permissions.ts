/**
 * CS5-B — the existing catalog keys each production ability reuses. No key is
 * new: every one is already in `PERMISSION_KEYS` (asserted by spec).
 */
export const CREATIVE_PRODUCTION_PERMISSIONS = {
  /** View production: same key as viewing the Studio library. */
  view: 'social.creative.content.view.assigned',
  /** Select / clear the creative, link/unlink work, reconcile. */
  update: 'social.creative.content.update.assigned',
  /**
   * CS5 Closeout — upload a new file from Production (or the Planner's
   * replacement): the Studio's own upload key, checked in addition to
   * `update` because the command creates a Creative Asset/Version.
   */
  create: 'social.creative.content.create_draft.assigned',
  /** Send the selected version for approval (CS2B.2 key). */
  submitReview: 'social.creative.content.submit_review.assigned',
  /** Destination handoff: the key that already governs destination creatives (E5). */
  plannerUpdate: 'social.planner.calendar.update.manager',
  /** Agency owner keys, checked in addition to `update`. */
  taskCreate: 'agency.tasks.task.create.assigned',
  taskUpdate: 'agency.tasks.task.update.assigned',
} as const;
