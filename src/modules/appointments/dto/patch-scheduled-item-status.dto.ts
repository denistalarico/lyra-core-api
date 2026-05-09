import { IsIn } from 'class-validator';

export class PatchScheduledItemStatusDto {
  @IsIn(['scheduled', 'in_progress', 'completed', 'canceled', 'missed', 'postponed'])
  status!: string;
}
