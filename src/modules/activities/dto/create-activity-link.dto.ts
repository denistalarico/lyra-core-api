import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ActivityEntityType, ActivityRelationType } from '../enums';

export class CreateActivityLinkDto {
  @IsEnum(ActivityEntityType)
  entityType!: ActivityEntityType;

  @IsUUID()
  entityId!: string;

  @IsOptional()
  @IsEnum(ActivityRelationType)
  relationType?: ActivityRelationType;
}
