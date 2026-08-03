/**
 * Suggestion lifecycle — every non-pending status is terminal:
 *   pending -> applied     (via a suggestion_applications insert)
 *   pending -> rejected    (human decision, draft untouched)
 *   pending -> superseded  (only automatic transition; only while the
 *                           superseded row is itself still pending)
 */
export enum LeadFlowBriefingSuggestionStatus {
  Pending = 'pending',
  Applied = 'applied',
  Rejected = 'rejected',
  Superseded = 'superseded',
}
