import { IsIn } from 'class-validator';

export class PatchCrmOpportunityVisibilityDto {
  @IsIn(['workspace', 'assigned_only', 'private'])
  visibility!: string;
}
