import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsIn,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PatchCrmStageDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  name?: string;

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
  @IsObject()
  metadata?: Record<string, unknown>;
}
