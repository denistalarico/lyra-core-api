import { Injectable } from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';

import {
  MeetingTokenInput,
  MeetingTokenResult,
  TeamChatMeetingProviderService,
} from './team-chat-meeting-provider.service';

@Injectable()
export class TeamChatLiveKitProviderService extends TeamChatMeetingProviderService {
  async createParticipantToken(
    input: MeetingTokenInput,
  ): Promise<MeetingTokenResult> {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL ?? null;

    if (!apiKey || !apiSecret || !url) {
      return {
        provider: 'livekit',
        url,
        token: null,
        roomName: input.roomName,
        identity: input.identity,
      };
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: input.identity,
      name: input.participantName,
    });

    token.addGrant({
      room: input.roomName,
      roomJoin: true,
      canPublish: input.canPublish ?? true,
      canSubscribe: input.canSubscribe ?? true,
      canPublishData: input.canPublishData ?? true,
      roomAdmin: input.isHost ?? false,
    });

    return {
      provider: 'livekit',
      url,
      token: await token.toJwt(),
      roomName: input.roomName,
      identity: input.identity,
    };
  }
}
