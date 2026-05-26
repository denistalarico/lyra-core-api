import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { CompleteActivityDto } from './complete-activity.dto';
import { CreateActivityDto } from './create-activity.dto';

export class CompleteAndScheduleNextActivityDto {
  @ValidateNested()
  @Type(() => CompleteActivityDto)
  completion!: CompleteActivityDto;

  @ValidateNested()
  @Type(() => CreateActivityDto)
  nextActivity!: CreateActivityDto;
}
