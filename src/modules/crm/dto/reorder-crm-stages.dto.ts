import { IsArray, IsInt, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReorderCrmStageItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  sortOrder!: number;
}

export class ReorderCrmStagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderCrmStageItemDto)
  stages!: ReorderCrmStageItemDto[];
}
