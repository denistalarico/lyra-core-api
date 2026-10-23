import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const INBOX_COMMENT_REPLY_STATUSES = [
  'unanswered',
  'answered',
  'ignored',
] as const;

export class ListInboxCommentsQueryDto {
  /** `instagram` or `facebook` (`facebook_messenger` is accepted as Facebook). */
  @IsOptional()
  @IsIn(['instagram', 'facebook', 'facebook_messenger'])
  channelType?: string;

  @IsOptional()
  @IsIn(INBOX_COMMENT_REPLY_STATUSES)
  replyStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  contentId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  onlyAds?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ReplyInboxCommentDto {
  @IsIn(['public', 'private'])
  mode!: 'public' | 'private';

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey!: string;
}

export class SetInboxCommentStatusDto {
  @IsIn(INBOX_COMMENT_REPLY_STATUSES)
  replyStatus!: (typeof INBOX_COMMENT_REPLY_STATUSES)[number];
}
