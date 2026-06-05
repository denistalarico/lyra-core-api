import {
  IsDateString,
  IsEnum,
  IsObject,
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

export class CreateClientDto {
  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsString()
  @MaxLength(180)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string | null;

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
  segment?: string | null;

  @IsOptional()
  @IsUUID()
  accountOwnerId?: string | null;

  @IsOptional()
  @IsUUID()
  managedTenantId?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}
