import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
  @IsObject()
  metadata?: Record<string, unknown>;
}
