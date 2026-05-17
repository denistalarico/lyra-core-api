import { IsUUID } from 'class-validator';

export class PatchCrmOpportunityStageDto {
  @IsUUID()
  stageId!: string;
}
