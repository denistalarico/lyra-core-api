import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { TeamChatMessagesService } from '../services/team-chat-messages.service';

type SocketContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

type JoinChannelPayload = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
  channelId: string;
};

type LeaveChannelPayload = {
  tenantId: string;
  workspaceId: string;
  channelId: string;
};

type SendMessagePayload = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
  channelId: string;
  kind?: 'text' | 'audio' | 'attachment' | 'system' | 'meeting_event';
  body?: string;
  parentMessageId?: string;
  senderDisplayName?: string;
};

type TypingPayload = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
  channelId: string;
  displayName?: string;
};

type ReadChannelPayload = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
  channelId: string;
};

@WebSocketGateway({
  namespace: '/agency/team-chat',
  cors: {
    origin: '*',
  },
})
export class TeamChatGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TeamChatGateway.name);

  constructor(private readonly messagesService: TeamChatMessagesService) {}

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('team-chat:join-channel')
  async joinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinChannelPayload,
  ) {
    const room = this.getChannelRoom(
      payload.tenantId,
      payload.workspaceId,
      payload.channelId,
    );

    await client.join(room);

    client.data.tenantId = payload.tenantId;
    client.data.workspaceId = payload.workspaceId;
    client.data.userId = payload.userId ?? null;

    client.to(room).emit('team-chat:user-joined-channel', {
      channelId: payload.channelId,
      userId: payload.userId ?? null,
      socketId: client.id,
    });

    return {
      ok: true,
      room,
      channelId: payload.channelId,
    };
  }

  @SubscribeMessage('team-chat:leave-channel')
  async leaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LeaveChannelPayload,
  ) {
    const room = this.getChannelRoom(
      payload.tenantId,
      payload.workspaceId,
      payload.channelId,
    );

    await client.leave(room);

    client.to(room).emit('team-chat:user-left-channel', {
      channelId: payload.channelId,
      socketId: client.id,
    });

    return {
      ok: true,
      room,
      channelId: payload.channelId,
    };
  }

  @SubscribeMessage('team-chat:send-message')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    const context = this.getContext(payload);
    const message = await this.messagesService.create(
      context,
      payload.channelId,
      {
        kind: payload.kind as never,
        body: payload.body,
        parentMessageId: payload.parentMessageId,
        senderDisplayName: payload.senderDisplayName,
      },
    );

    const room = this.getChannelRoom(
      payload.tenantId,
      payload.workspaceId,
      payload.channelId,
    );

    // Broadcast to all OTHER clients in the room (sender gets message via ACK callback)
    client.to(room).emit('team-chat:message-created', message);

    // Return message directly so the sender's ACK callback gets the persisted message
    return message;
  }

  @SubscribeMessage('team-chat:typing-start')
  typingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TypingPayload,
  ) {
    const room = this.getChannelRoom(
      payload.tenantId,
      payload.workspaceId,
      payload.channelId,
    );

    client.to(room).emit('team-chat:user-typing', {
      channelId: payload.channelId,
      userId: payload.userId ?? null,
      displayName: payload.displayName ?? null,
      socketId: client.id,
      typing: true,
    });

    return {
      ok: true,
    };
  }

  @SubscribeMessage('team-chat:typing-stop')
  typingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TypingPayload,
  ) {
    const room = this.getChannelRoom(
      payload.tenantId,
      payload.workspaceId,
      payload.channelId,
    );

    client.to(room).emit('team-chat:user-typing', {
      channelId: payload.channelId,
      userId: payload.userId ?? null,
      displayName: payload.displayName ?? null,
      socketId: client.id,
      typing: false,
    });

    return {
      ok: true,
    };
  }

  @SubscribeMessage('team-chat:mark-read')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadChannelPayload,
  ) {
    const context = this.getContext(payload);
    const readState = await this.messagesService.markAsRead(
      context,
      payload.channelId,
    );
    const room = this.getChannelRoom(
      payload.tenantId,
      payload.workspaceId,
      payload.channelId,
    );

    this.server.to(room).emit('team-chat:channel-read', {
      channelId: payload.channelId,
      userId: payload.userId ?? null,
      readState,
    });

    return {
      ok: true,
      readState,
    };
  }

  /**
   * Pushes a message created outside a socket — by REST, or by another module
   * posting on behalf of the platform — to everyone watching the channel.
   *
   * `client.to(room)` in the socket handler above excludes the sender, which is
   * right when a person typed the message. Here there is no sender socket to
   * exclude, so the server broadcasts to the whole room.
   */
  broadcastMessageCreated(
    tenantId: string,
    workspaceId: string,
    channelId: string,
    message: unknown,
  ): void {
    this.server
      ?.to(this.getChannelRoom(tenantId, workspaceId, channelId))
      .emit('team-chat:message-created', message);
  }

  private getContext(payload: {
    tenantId: string;
    workspaceId: string;
    userId?: string;
  }): SocketContext {
    return {
      tenantId: payload.tenantId,
      workspaceId: payload.workspaceId,
      userId: payload.userId ?? null,
    };
  }

  private getChannelRoom(
    tenantId: string,
    workspaceId: string,
    channelId: string,
  ) {
    return `agency:${tenantId}:${workspaceId}:team-chat:channel:${channelId}`;
  }
}
