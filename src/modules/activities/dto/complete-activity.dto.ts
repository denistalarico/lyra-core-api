import { IsOptional, IsString } from 'class-validator';

export class CompleteActivityDto {
  @IsOptional()
  @IsString()
  feedback?: string | null;
}
