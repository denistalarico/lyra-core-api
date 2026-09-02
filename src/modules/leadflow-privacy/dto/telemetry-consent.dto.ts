import {
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const LEADFLOW_PRODUCT_TELEMETRY_PURPOSE =
  'leadflow_product_improvement_v1';

export const PLATFORM_PRODUCT_TELEMETRY_PURPOSE =
  'platform_product_improvement_v1';

/**
 * Both purposes are accepted here (Lyra Social S1.4.8) — this only widens
 * the set of *syntactically* valid values, exactly the backward-compatible
 * "alargar, nunca reinterpretar" rule from D-4 / D-11 item 12.
 *
 * Widening this list does NOT let a caller consent across purposes: the
 * service requires `dto.purposeKey === notice.purposeKey` AND the notice to
 * belong to the purpose the called route operates on. A `/leadflow/...`
 * opt-in carrying the platform purpose is rejected because the LeadFlow
 * route resolves the LeadFlow purpose, and vice versa.
 */
export const TELEMETRY_PURPOSE_KEYS = [
  LEADFLOW_PRODUCT_TELEMETRY_PURPOSE,
  PLATFORM_PRODUCT_TELEMETRY_PURPOSE,
] as const;

export type TelemetryPurposeKey = (typeof TELEMETRY_PURPOSE_KEYS)[number];

export class OptInLeadFlowTelemetryDto {
  @IsUUID()
  noticeId!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  contentHash!: string;

  @IsIn([...TELEMETRY_PURPOSE_KEYS])
  purposeKey!: TelemetryPurposeKey;
}

export class OptOutLeadFlowTelemetryDto {
  @IsIn([
    'preference_changed',
    'purpose_not_accepted',
    'retention_not_accepted',
    'other',
  ])
  reasonCode!:
    | 'preference_changed'
    | 'purpose_not_accepted'
    | 'retention_not_accepted'
    | 'other';
}

export class CollectLeadFlowTelemetryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class TelemetryErasureDto {
  @IsString()
  @MaxLength(40)
  @IsIn(['user_request', 'scope_closure', 'other'])
  reasonCode!: 'user_request' | 'scope_closure' | 'other';
}
