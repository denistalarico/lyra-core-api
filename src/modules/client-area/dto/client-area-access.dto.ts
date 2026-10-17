import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  CLIENT_AREA_MODULE_KEYS,
  type ClientAreaModuleLevels,
} from '../client-area.types';
import { CLIENT_AREA_CONSENT_PURPOSES } from '../services/client-area-consent.service';
export class PutClientAreaModuleAccessDto {
  @IsObject() moduleLevels!: ClientAreaModuleLevels;
}
export class ClientAreaConsentDecisionDto {
  @IsIn(CLIENT_AREA_CONSENT_PURPOSES) purposeKey!: string;
  @IsIn(['accept', 'decline', 'revoke']) decision!:
    | 'accept'
    | 'decline'
    | 'revoke';
  @IsUUID() noticeId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) contentHash!: string;
}
export class ListAuditChangesDto {
  @IsOptional() @IsUUID() companyContextId?: string;
  @IsOptional() @IsIn(CLIENT_AREA_MODULE_KEYS) moduleKey?: string;
  @IsOptional()
  @IsIn(['agency', 'client_area', 'system'])
  actorSurface?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
