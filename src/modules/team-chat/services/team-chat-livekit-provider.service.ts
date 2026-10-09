import { Injectable } from '@nestjs/common';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

import {
  MeetingTokenInput,
  MeetingTokenResult,
  TeamChatMeetingProviderService,
} from './team-chat-meeting-provider.service';

@Injectable()
export class TeamChatLiveKitProviderService extends TeamChatMeetingProviderService {
  private roomClient(): RoomServiceClient | null {
    const {
      LIVEKIT_URL: url,
      LIVEKIT_API_KEY: key,
      LIVEKIT_API_SECRET: secret,
    } = process.env;
    return url && key && secret
      ? new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret)
      : null;
  }

  async roomOccupancy(names: string[]): Promise<Map<string, number> | null> {
    const client = this.roomClient();
    if (!client) return null;
    const rooms = await client.listRooms(names);
    // Room.numParticipants can lag or remain zero for connected listeners.
    // Inspect actual participants so muted users still keep the meeting alive.
    const occupancy = await Promise.all(
      rooms.map(async (room): Promise<[string, number]> => {
        const participants = await client.listParticipants(room.name);
        return [
          room.name,
          participants.filter(
            ({ permission }) =>
              !permission?.hidden &&
              !permission?.recorder &&
              !permission?.agent,
          ).length,
        ];
      }),
    );
    return new Map(occupancy);
  }

  async closeRoom(name: string): Promise<void> {
    const client = this.roomClient();
    if (!client) return;
    if ((await client.listRooms([name])).length) await client.deleteRoom(name);
  }

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
      metadata: JSON.stringify({ avatarUrl: input.avatarUrl ?? null }),
      ttl: '5m',
    });

    token.addGrant({
      room: input.roomName,
      roomJoin: true,
      canPublish: input.canPublish ?? true,
      canSubscribe: input.canSubscribe ?? true,
      canPublishData: input.canPublishData ?? true,
      canUpdateOwnMetadata: true,
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
