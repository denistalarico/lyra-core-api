import { PlatformPermissionService } from '../../permissions/services/platform-permission.service';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { AgencyClientConversationAccessService } from './agency-client-conversation-access.service';
import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { toCompanyAwareScope } from '../../client-area/client-area-scope';
import type { ClientAreaSettingsRequest } from '../../client-area/client-area-settings-requests.registry';
import type { ClientAreaContext } from '../../client-area/client-area.types';
import { NotificationRecipientSurface } from '../../notifications/enums';
import { AgencyClientConversationsGateway } from '../gateways/agency-client-conversations.gateway';
import { ClientConversationsGateway } from '../gateways/client-conversations.gateway';
import { ClientConversationsService } from './client-conversations.service';
import { ClientConversationNotificationPublisher } from './client-conversation-notification.publisher';

/** Requests use the existing platform-card writer; the human requester is explicit in metadata.card. */
@Injectable()
export class ClientSettingsRequestPublisher {
  private readonly logger = new Logger(ClientSettingsRequestPublisher.name);
  constructor(
    private readonly access: AgencyClientConversationAccessService,
    private readonly agencyPermissions: PlatformPermissionService,
    private readonly conversations: ClientConversationsService,
    private readonly notices: ClientConversationNotificationPublisher,
    private readonly agencyRealtime: AgencyClientConversationsGateway,
    private readonly clientRealtime: ClientConversationsGateway,
    @InjectRepository(AgencyWorkspaceUserEntity, 'agency')
    private readonly users: Repository<AgencyWorkspaceUserEntity>,
  ) {}
  async publish(context: ClientAreaContext, input: ClientAreaSettingsRequest) {
    const scope = toCompanyAwareScope(context);
    const actor = {
      surface: 'client_area' as const,
      userId: context.userId,
      membershipId: context.membershipId,
    };
    const conversation = await this.conversations.ensureDefaultConversation(
      scope,
      actor,
    );
    const body =
      input.kind === 'invitation_request'
        ? `Solicitação de convite: ${input.displayName} (${input.email}). Níveis sugeridos: ${JSON.stringify(input.moduleLevels)}`
        : `Solicitação de exclusão de dados: ${input.reason}`;
    const result = await this.conversations.publishCard(
      scope,
      {
        kind: 'settings_request',
        title: body,
        requestedByUserId: context.userId,
        request: input,
      },
      `client_area_settings_request:${randomUUID()}`,
    );
    if (!result.message || result.conversationId !== conversation.id)
      throw new ServiceUnavailableException('Request could not be delivered.');
    const message = result.message;
    const broadcast = {
      tenantId: scope.tenantId,
      companyContextId: scope.companyContextId,
      conversationId: conversation.id,
      message,
    };
    this.agencyRealtime.broadcastMessageCreated(broadcast);
    this.clientRealtime.broadcastMessageCreated(broadcast);
    try {
      const fallback = await this.users.find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          status: 'active',
          role: In(['owner', 'admin']),
        },
      });
      const recipients: string[] = [];
      for (const row of fallback) {
        if (!row.userId) continue;
        try {
          // This is a real Agency recipient from workspace_users, never the client actor.
          if (
            !(await this.agencyPermissions.can(
              {
                tenantId: scope.tenantId,
                workspaceId: scope.workspaceId,
                userId: row.userId,
                role: row.role,
              },
              'agency.client_conversations.view.assigned',
            ))
          )
            continue;
          await this.access.resolveScope(
            {
              tenantId: scope.tenantId,
              workspaceId: scope.workspaceId,
              userId: row.userId,
              role: row.role,
            },
            scope.companyContextId,
          );
          recipients.push(row.userId);
        } catch (error) {
          if (
            !(error instanceof ForbiddenException) &&
            !(error instanceof NotFoundException)
          )
            throw error;
        }
      }
      await this.notices.publishMessageCreated({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        companyContextId: scope.companyContextId,
        conversationId: conversation.id,
        messageId: message.id,
        authorSurface: NotificationRecipientSurface.CLIENT_AREA,
        authorUserId: context.userId,
        createdAt: new Date(message.createdAt),
        agencyFallbackRecipientUserIds: recipients,
      });
    } catch {
      this.logger.warn({
        message: 'settings_request_notification_failed',
        requestId: message.id,
      });
    }
    return { requestId: message.id, conversationId: conversation.id };
  }
}
