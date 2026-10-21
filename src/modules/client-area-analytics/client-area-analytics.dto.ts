import {
  IsISO8601,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
export class CreateClientAreaDashboardDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsObject() layout?: unknown;
}
export class UpdateClientAreaDashboardDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsObject() layout?: unknown;
}
export class DuplicateClientAreaDashboardDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
}
export class ClientAreaAnalyticsReadDto {
  @IsOptional() @IsIn(['overview', 'series']) view?: 'overview' | 'series';
  @IsOptional()
  @IsIn(['facebook', 'instagram', 'meta_ads', 'summary', 'google_ads'])
  socialChannel?:
    | 'facebook'
    | 'instagram'
    | 'meta_ads'
    | 'summary'
    | 'google_ads';
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsUUID() connectionId?: string;
  @IsOptional() @IsUUID() facebookAssetId?: string;
  @IsOptional() @IsUUID() instagramAssetId?: string;
  @IsOptional() @IsUUID() channelId?: string;
  @IsOptional() @IsUUID() agentId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/i)
  businessMode?: string;
}
