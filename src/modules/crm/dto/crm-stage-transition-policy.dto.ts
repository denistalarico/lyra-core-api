import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type {
  CrmStageTransitionActor,
  CrmStageTransitionConditionContract,
} from '../entities/crm-stage-transition-policy.entity';

export class CreateCrmStageTransitionPolicyDto {
  @IsUUID()
  pipelineId!: string;

  @IsUUID()
  fromStageId!: string;

  @IsUUID()
  toStageId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(4)
  @IsIn(['human', 'ai', 'automation', 'system'], { each: true })
  allowedActors!: CrmStageTransitionActor[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  requiredFields?: string[];

  @IsOptional()
  @IsObject()
  conditionContract?: CrmStageTransitionConditionContract;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  reasonCodes!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  aiGuidance?: string | null;
}

export class PatchCrmStageTransitionPolicyDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(4)
  @IsIn(['human', 'ai', 'automation', 'system'], { each: true })
  allowedActors?: CrmStageTransitionActor[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  requiredFields?: string[];

  @IsOptional()
  @IsObject()
  conditionContract?: CrmStageTransitionConditionContract;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  reasonCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  aiGuidance?: string | null;
}
