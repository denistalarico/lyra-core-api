import { IsUUID } from 'class-validator';

export class ConfirmGoogleConnectionDto {
  @IsUUID()
  sessionId!: string;
}
