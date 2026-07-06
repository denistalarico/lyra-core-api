import { IsArray, IsInt, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReorderCrmOpportunityItemDto {
  @IsUUID()
  id!: string;

  @IsUUID()
  stageId!: string;

  @IsInt()
  sortOrder!: number;
}

export class ReorderCrmOpportunitiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderCrmOpportunityItemDto)
  opportunities!: ReorderCrmOpportunityItemDto[];
}
