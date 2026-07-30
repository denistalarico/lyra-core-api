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

export class OptInLeadFlowTelemetryDto {
  @IsUUID()
  noticeId!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  contentHash!: string;

  @IsIn([LEADFLOW_PRODUCT_TELEMETRY_PURPOSE])
  purposeKey!: typeof LEADFLOW_PRODUCT_TELEMETRY_PURPOSE;
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
