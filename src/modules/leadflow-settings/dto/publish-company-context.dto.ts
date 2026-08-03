import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `expectedDraftHash` lets the client prove the draft it previewed is still
 * the draft being published — optimistic concurrency between a human's
 * preview and their confirm click, distinct from the DB-level pessimistic
 * lock that already guards two simultaneous publishes.
 */
export class PublishCompanyContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  expectedDraftHash?: string;
}

export type CompanyContextChangeOrigin = 'manual' | 'suggestion';

export interface CompanyContextFieldChange {
  fieldPath: string;
  previousValue: unknown;
  nextValue: unknown;
  origin: CompanyContextChangeOrigin;
  suggestionId?: string;
  appliedById?: string;
  appliedAt?: Date;
}

export interface CompanyContextPreviewResponse {
  schemaVersion: number;
  hash: string;
  bytes: number;
  estimatedTokens: number;
  sections: string[];
  offerCount: number;
  faqCount: number;
  linkCount: number;
  changes: CompanyContextFieldChange[];
  hasChanges: boolean;
  currentPublishedVersion: number;
  currentPublishedHash: string | null;
}
