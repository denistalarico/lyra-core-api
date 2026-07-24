import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsIn,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CRM_STAGE_ROLES, type CrmStageRole } from '../entities/crm-stage.entity';

export class CreateCrmStageDto {
  @IsUUID()
  pipelineId!: string;

  @IsString()
  @MaxLength(140)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsBoolean()
  isWonStage?: boolean;

  @IsOptional()
  @IsBoolean()
  isLostStage?: boolean;

  @IsOptional()
  @IsBoolean()
  isFolded?: boolean;

  @IsOptional()
  @IsBoolean()
  isInitialStage?: boolean;

  @IsOptional()
  @IsIn(['ai_managed', 'human_managed', 'hybrid'])
  operationMode?: 'ai_managed' | 'human_managed' | 'hybrid';

  @IsOptional()
  @IsIn(CRM_STAGE_ROLES as unknown as string[])
  role?: CrmStageRole;

  @IsOptional()
  @IsObject()
  roleConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
