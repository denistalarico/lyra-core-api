import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ClientLifecycleIntervalUnit, ClientLifecycleStepStatus } from '../enums';

export class StartClientLifecycleDto {
  @IsOptional()
  @IsUUID()
  templateConfigOptionId?: string;
}

export class CreateClientLifecycleStepDto {
  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  stepTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  assigneeLabel?: string | null;

  @IsOptional()
  @IsString()
  assignment?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalValue?: number | null;

  @IsOptional()
  @IsEnum(ClientLifecycleIntervalUnit)
  intervalUnit?: ClientLifecycleIntervalUnit | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class UpdateClientLifecycleStepDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  stepTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  assigneeLabel?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string | null;

  @IsOptional()
  @IsString()
  assignment?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalValue?: number | null;

  @IsOptional()
  @IsEnum(ClientLifecycleIntervalUnit)
  intervalUnit?: ClientLifecycleIntervalUnit | null;

  @IsOptional()
  @IsEnum(ClientLifecycleStepStatus)
  status?: ClientLifecycleStepStatus;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class CompleteClientLifecycleDto {
  @IsOptional()
  @IsUUID()
  lostReasonId?: string;
}
