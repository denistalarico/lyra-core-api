import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePublicWebchatMessageDto {
  @IsUUID()
  visitorId!: string;

  @IsString()
  @MaxLength(5000)
  content!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
