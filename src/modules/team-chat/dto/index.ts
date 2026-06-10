import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  TeamChatChannelKind,
  TeamChatChannelStatus,
  TeamChatChannelVisibility,
  TeamChatMessageKind,
  TeamChatMeetingAccessMode,
} from '../enums';

export class CreateTeamChatChannelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(TeamChatChannelKind)
  kind?: TeamChatChannelKind;

  @IsOptional()
  @IsEnum(TeamChatChannelVisibility)
  visibility?: TeamChatChannelVisibility;

  @IsOptional()
  @IsUUID()
  relatedClientId?: string;

  @IsOptional()
  @IsUUID()
  relatedProjectId?: string;

  @IsOptional()
  @IsUUID()
  relatedTaskId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class PatchTeamChatChannelDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsEnum(TeamChatChannelVisibility)
  visibility?: TeamChatChannelVisibility;

  @IsOptional()
  @IsEnum(TeamChatChannelStatus)
  status?: TeamChatChannelStatus;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ListTeamChatChannelsQueryDto {
  @IsOptional()
  @IsEnum(TeamChatChannelKind)
  kind?: TeamChatChannelKind;

  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateTeamChatMessageDto {
  @IsOptional()
  @IsEnum(TeamChatMessageKind)
  kind?: TeamChatMessageKind;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsUUID()
  parentMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  senderDisplayName?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class PatchTeamChatMessageDto {
  @IsOptional()
  @IsString()
  body?: string | null;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ReactToTeamChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  emoji!: string;
}

export class ListTeamChatMessagesQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsDateString()
  before?: string;
}

export class CreateTeamChatMeetingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(TeamChatMeetingAccessMode)
  accessMode?: TeamChatMeetingAccessMode;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsUUID()
  relatedClientId?: string;

  @IsOptional()
  @IsUUID()
  relatedProjectId?: string;

  @IsOptional()
  @IsUUID()
  relatedTaskId?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  transcriptionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiSummaryEnabled?: boolean;
}

export class PatchTeamChatMeetingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;
}

export class CreateTeamChatAttachmentDto {
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @IsOptional()
  @IsUUID()
  meetingRoomId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalFileName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  mimeType!: string;

  @IsString()
  @IsNotEmpty()
  sizeBytes!: string;

  @IsString()
  @IsNotEmpty()
  storageKey!: string;

  @IsOptional()
  @IsString()
  publicUrl?: string;

  @IsOptional()
  width?: number;

  @IsOptional()
  height?: number;

  @IsOptional()
  durationSeconds?: number;
}

export class JoinTeamChatMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;
}

export class JoinPublicTeamChatMeetingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  guestName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  guestEmail?: string;
}

export class CreateTeamChatMeetingEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  type!: string;

  @IsOptional()
  payload?: Record<string, unknown>;
}

export class RequestTeamChatMeetingAiSummaryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  transcriptRef?: string;
}

export class SearchTeamChatMessagesQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class AddTeamChatChannelMembersDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  userIds!: string[];
}

export class FindOrCreateDirectChannelDto {
  @IsUUID()
  targetUserId!: string;
}

export class SaveTeamChatUserSettingsDto {
  data!: Record<string, unknown>;
}

export class UpdateChannelMembershipDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  notificationLevel?: string;

  @IsOptional()
  @IsDateString()
  mutedUntil?: string | null;
}
