export enum TeamChatChannelKind {
  CHANNEL = 'channel',
  DIRECT = 'direct',
  MEETING = 'meeting',
}

export enum TeamChatChannelStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum TeamChatChannelVisibility {
  PRIVATE = 'private',
  WORKSPACE = 'workspace',
  CLIENT_CONTEXT = 'client_context',
  PROJECT_CONTEXT = 'project_context',
}

export enum TeamChatMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  GUEST = 'guest',
}

export enum TeamChatNotificationLevel {
  ALL = 'all',
  MENTIONS = 'mentions',
  MUTED = 'muted',
}

export enum TeamChatMessageKind {
  TEXT = 'text',
  AUDIO = 'audio',
  ATTACHMENT = 'attachment',
  SYSTEM = 'system',
  MEETING_EVENT = 'meeting_event',
}

export enum TeamChatMessageStatus {
  SENT = 'sent',
  EDITED = 'edited',
  DELETED = 'deleted',
}

export enum TeamChatAttachmentKind {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  OTHER = 'other',
}

export enum TeamChatMeetingStatus {
  SCHEDULED = 'scheduled',
  WAITING = 'waiting',
  LIVE = 'live',
  ENDED = 'ended',
  CANCELED = 'canceled',
}

export enum TeamChatMeetingAccessMode {
  INTERNAL = 'internal',
  PUBLIC_LINK = 'public_link',
}

export enum TeamChatMeetingProvider {
  LIVEKIT = 'livekit',
  MANUAL = 'manual',
}

export enum TeamChatMeetingParticipantRole {
  HOST = 'host',
  COHOST = 'cohost',
  MEMBER = 'member',
  GUEST = 'guest',
}

export enum TeamChatMeetingParticipantStatus {
  INVITED = 'invited',
  JOINED = 'joined',
  LEFT = 'left',
  REMOVED = 'removed',
}

export enum TeamChatAiSummaryStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
