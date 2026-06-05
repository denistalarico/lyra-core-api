import {
  IsBooleanString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  AgencyClientHealthStatus,
  AgencyClientLifecycleStage,
  AgencyClientStatus,
} from '../enums';

export class ListClientsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(AgencyClientStatus)
  status?: AgencyClientStatus;

  @IsOptional()
  @IsEnum(AgencyClientLifecycleStage)
  lifecycleStage?: AgencyClientLifecycleStage;

  @IsOptional()
  @IsEnum(AgencyClientHealthStatus)
  healthStatus?: AgencyClientHealthStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  segment?: string;

  @IsOptional()
  @IsUUID()
  accountOwnerId?: string;

  @IsOptional()
  @IsBooleanString()
  includeArchived?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsNumberString()
  offset?: string;
}
