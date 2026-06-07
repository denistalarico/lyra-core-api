export type MeetingTokenInput = {
  roomName: string;
  identity: string;
  participantName: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  isHost?: boolean;
};

export type MeetingTokenResult = {
  provider: 'livekit' | 'manual';
  url: string | null;
  token: string | null;
  roomName: string;
  identity: string;
};

export abstract class TeamChatMeetingProviderService {
  abstract createParticipantToken(
    input: MeetingTokenInput,
  ): Promise<MeetingTokenResult>;
}
