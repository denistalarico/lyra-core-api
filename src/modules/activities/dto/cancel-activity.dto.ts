import { IsOptional, IsString } from 'class-validator';

export class CancelActivityDto {
  @IsOptional()
  @IsString()
  reason?: string | null;
}
