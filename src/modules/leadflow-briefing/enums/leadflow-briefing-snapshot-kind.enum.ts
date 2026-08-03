/** What produced a context_snapshots row — draft mutations and publish events share one append-only ledger. */
export enum LeadFlowBriefingSnapshotKind {
  ManualEdit = 'manual_edit',
  SuggestionApplied = 'suggestion_applied',
  Published = 'published',
}
