/** Ingestion status of one source version. Populated by F4-002 (secure upload/fetch); nothing writes past Pending yet. */
export enum LeadFlowBriefingSourceVersionStatus {
  Pending = 'pending',
  Processing = 'processing',
  Available = 'available',
  Failed = 'failed',
}
