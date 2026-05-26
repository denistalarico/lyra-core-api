import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProjectEventDto {
  @IsIn(['activity', 'note'])
  kind!: 'activity' | 'note';

  @IsString()
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;
}
