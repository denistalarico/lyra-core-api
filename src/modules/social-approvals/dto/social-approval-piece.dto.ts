import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SOCIAL_APPROVAL_BOARD_COLUMNS,
  SOCIAL_APPROVAL_PIECE_KINDS,
} from '../entities';

export class SocialApprovalBoardQueryDto {
  @IsOptional() @IsIn(SOCIAL_APPROVAL_BOARD_COLUMNS) column?: string;
  @IsOptional() @IsString() @MaxLength(32) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsIn(['all', 'own', 'managed']) scope?:
    | 'all'
    | 'own'
    | 'managed';
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsUUID() campaignId?: string;
  @IsOptional() @IsIn(SOCIAL_APPROVAL_PIECE_KINDS) kind?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class ClientApprovalBoardQueryDto {
  @IsOptional()
  @IsIn(['awaiting_you', 'with_agency', 'approved', 'finished'])
  column?: 'awaiting_you' | 'with_agency' | 'approved' | 'finished';
  @IsOptional() @IsString() @MaxLength(32) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreateStandalonePieceDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsIn(['text', 'link', 'file', 'media']) stepKind!:
    | 'text'
    | 'link'
    | 'file'
    | 'media';
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20000) text?: string;
  /** D-29: http and https only; the server never fetches it. */
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url?: string;
  @IsOptional() @IsString() @MaxLength(255) linkLabel?: string;
  @IsOptional() @IsUUID() mediaAssetId?: string;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mediaAssetIds?: string[];
}

export class FinishSocialApprovalPieceDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class UpdateSocialApprovalSettingsDto {
  @IsOptional() @IsBoolean() internalApprovalEnabled?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  internalApproverUserIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  clientApproverMembershipIds?: string[];
  @IsOptional() @IsIn(['first', 'all']) clientDecisionPolicy?: 'first' | 'all';
  @IsOptional() @IsBoolean() clientCanEditText?: boolean;
  @IsOptional() @IsBoolean() sendToConversation?: boolean;
  @IsOptional() @IsBoolean() registerDecisionsInConversation?: boolean;
  @IsOptional() @IsUUID() teamChatChannelId?: string | null;
  @IsOptional() @IsObject() notificationEvents?: Record<string, unknown>;
}
