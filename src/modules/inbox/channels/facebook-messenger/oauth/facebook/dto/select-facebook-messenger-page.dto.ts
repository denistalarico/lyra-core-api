import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class SelectFacebookMessengerPageDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @MaxLength(180)
  @Matches(/^\d+$/)
  pageId!: string;
}
