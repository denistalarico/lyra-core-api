import { IsString, Matches, MaxLength } from 'class-validator';

export class SelectYoutubeChannelDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[\w-]+$/)
  channelId!: string;
}
