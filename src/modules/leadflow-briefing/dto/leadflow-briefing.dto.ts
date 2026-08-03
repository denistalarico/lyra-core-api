import type { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import type { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';

/**
 * Internal service contracts for the leadflow-briefing module. No HTTP
 * controller exists yet (deferred to F4-004's review API) — these are
 * consumed directly by F4-002 (ingestion) and F4-003 (extraction worker).
 */

export interface CreateBriefingSourceInput {
  settingsId: string;
  contextType: LeadFlowSettingsContextType;
  agencyClientId: string | null;
  kind: LeadFlowBriefingSourceKind;
  label: string;
  createdById: string | null;
}

export interface BriefingSourceResponse {
  id: string;
  settingsId: string;
  kind: LeadFlowBriefingSourceKind;
  label: string;
  status: 'active' | 'archived';
  latestVersionNumber: number;
  createdAt: Date;
}

export interface CreateBriefingSourceVersionInput {
  sourceId: string;
  kind: LeadFlowBriefingSourceKind;
  objectKey?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  mimeType?: string | null;
  byteSize?: string | null;
  checksum?: string | null;
  safeFilename?: string | null;
  createdById: string | null;
  /**
   * Defaults to Pending (the F4-001 behavior) when omitted. F4-002's
   * ingestion flow validates/scans/uploads content BEFORE this call, so it
   * passes Available directly — the row is only ever created once the
   * content is already known-safe, never inserted first and validated after.
   */
  status?: LeadFlowBriefingSourceVersionStatus;
  errorCode?: string | null;
}

export interface BriefingSourceVersionResponse {
  id: string;
  sourceId: string;
  versionNumber: number;
  status: string;
  createdAt: Date;
}

export interface EnqueueExtractionJobInput {
  settingsId: string;
  sourceId: string;
  sourceVersionId: string;
  jobKind?: string;
  createdById: string | null;
}

export interface BriefingExtractionJobResponse {
  id: string;
  sourceVersionId: string;
  status: string;
  attempts: number;
  idempotencyKey: string;
}

export interface RecordSuggestionInput {
  fieldPath: string;
  suggestedValue: unknown;
  confidence?: number | null;
  rationale?: string | null;
}

export interface RecordSuggestionsInput {
  extractionJobId: string;
  settingsId: string;
  sourceVersionId: string;
  suggestions: RecordSuggestionInput[];
}

export interface BriefingSuggestionResponse {
  id: string;
  fieldPath: string;
  status: string;
  conflictsWithSuggestionId: string | null;
  supersededBySuggestionId: string | null;
}

export interface ApplySuggestionInput {
  suggestionId: string;
  appliedById: string;
}

export interface RejectSuggestionInput {
  suggestionId: string;
  decidedById: string;
}

export interface BriefingApplicationResponse {
  id: string;
  suggestionId: string;
  fieldPath: string;
  resultingSnapshotId: string;
  createdAt: Date;
}

export interface BriefingFieldProvenanceResponse {
  fieldPath: string;
  origin: 'manual' | 'suggestion';
  suggestionId?: string;
  sourceVersionId?: string;
  sourceId?: string;
  appliedAt?: Date;
  appliedById?: string;
}
