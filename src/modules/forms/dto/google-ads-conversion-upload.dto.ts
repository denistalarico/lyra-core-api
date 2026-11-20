import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const ACTION_RESOURCE = /^customers\/\d{1,20}\/conversionActions\/\d{1,20}$/;

export class GoogleAdsConversionConnectionQueryDto {
  @IsUUID()
  connectionId!: string;
}

export class GoogleAdsConversionHistoryQueryDto extends GoogleAdsConversionConnectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

/** GA-CONV (§5.4). Absent = unchanged; `null` clears an action. */
export class UpdateGoogleAdsConversionUploadDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(ACTION_RESOURCE)
  qualifiedActionResource?: string | null;

  @IsOptional()
  @IsString()
  @Matches(ACTION_RESOURCE)
  wonActionResource?: string | null;

  @IsOptional()
  @IsBoolean()
  sendValue?: boolean;
}
