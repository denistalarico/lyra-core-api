import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWebchatAdminMessageDto {
  @IsString()
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
