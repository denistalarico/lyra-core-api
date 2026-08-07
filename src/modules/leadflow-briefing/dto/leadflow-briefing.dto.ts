import type { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import type { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';

/**
 * Internal service contracts for the leadflow-briefing module, consumed
 * directly by F4-002 (ingestion), F4-003 (extraction worker) and F4-004's
 * review controller (list/apply/reject).
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
  sourceId: string;
  sourceVersionId: string;
  status: string;
  attempts: number;
  idempotencyKey: string;
  lastError: string | null;
  createdAt: Date;
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
  /**
   * Reviewer-edited replacement for the model's proposal. The suggestion row
   * keeps the original suggested_value — what a human actually committed is
   * recorded on the application row, so provenance still distinguishes
   * "the model said this" from "a person approved that".
   */
  value?: unknown;
}

export interface ConfirmSuggestionsInput {
  settingsId: string;
  appliedById: string;
  items: Array<{ suggestionId: string; value?: unknown }>;
}

export interface BriefingConfirmationResponse {
  snapshotId: string;
  applications: BriefingApplicationResponse[];
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

export interface BriefingSourceListItemResponse {
  id: string;
  kind: LeadFlowBriefingSourceKind;
  label: string;
  status: 'active' | 'archived';
  latestVersion: {
    id: string;
    versionNumber: number;
    status: string;
    errorCode: string | null;
    createdAt: Date;
  } | null;
  createdAt: Date;
}

export interface BriefingReviewFieldOrigin {
  sourceId: string;
  sourceLabel: string;
  sourceKind: LeadFlowBriefingSourceKind;
  sourceVersionId: string;
  versionNumber: number;
}

export interface BriefingSuggestionListItemResponse {
  id: string;
  fieldPath: string;
  status: string;
  suggestedValue: unknown;
  confidence: number | null;
  rationale: string | null;
  currentValue: unknown;
  conflictsWithSuggestionId: string | null;
  origin: BriefingReviewFieldOrigin;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface BriefingReviewResponse {
  suggestions: BriefingSuggestionListItemResponse[];
  gaps: string[];
}
