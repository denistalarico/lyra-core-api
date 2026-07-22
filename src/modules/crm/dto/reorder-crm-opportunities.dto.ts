import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReorderCrmOpportunityItemDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  stageId!: string;

  @IsInt()
  sortOrder!: number;

  @IsOptional()
  @IsInt()
  expectedVersion?: number;

  @IsString()
  @MaxLength(80)
  reasonCode!: string;
}

export class ReorderCrmOpportunitiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderCrmOpportunityItemDto)
  opportunities!: ReorderCrmOpportunityItemDto[];
}
