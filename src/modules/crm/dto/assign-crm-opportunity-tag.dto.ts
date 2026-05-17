import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

export class AssignCrmOpportunityTagDto {
  @IsUUID()
  tagId!: string;

  @IsOptional()
  @IsIn(['user', 'ai', 'automation', 'system'])
  assignedByType?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
