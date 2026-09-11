import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { NotificationActorType, NotificationInterestReason, NotificationProductKey } from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import type { NotificationExplicitRecipient } from '../../notifications/types';
import { PlatformPermissionService } from '../../permissions';
import { SocialPublicationEntity } from './entities/social-publication.entity';

const AGENCY_CONNECTION = 'agency';
const VIEW_PUBLICATION_PERMISSION = 'social.publishing.publication.view.assigned';
type FailedSocialPublication = Pick<
  SocialPublicationEntity,
  'id' | 'tenantId' | 'workspaceId' | 'agencyClientId' | 'contentItemId' | 'failureReason'
>;

/**
 * Emits a terminal publication failure only to operators who can still open
 * that Social context. The worker remains durable if notification delivery is
 * unavailable: a failed queue row must never be retried only for an alert.
 */
@Injectable()
export class SocialPublicationNotificationPublisher {
  private readonly logger = new Logger(SocialPublicationNotificationPublisher.name);

  constructor(
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepository: Repository<AgencyWorkspaceUserEntity>,
    private readonly permissions: PlatformPermissionService,
    private readonly notificationEvents: NotificationEventProcessorService,
  ) {}

  async publishFailure(publication: FailedSocialPublication): Promise<void> {
    try {
      const recipients = await this.resolveRecipients(publication);
      if (recipients.length === 0) return;

      await this.notificationEvents.process({
        eventId: `social.publishing.publication_failed:${publication.id}`,
        eventType: 'social.publishing.publication_failed',
        tenantId: publication.tenantId,
        workspaceId: publication.workspaceId,
        productKey: NotificationProductKey.SOCIAL,
        moduleKey: 'social',
        actorType: NotificationActorType.SYSTEM,
        resourceType: 'social_publication',
        resourceId: publication.id,
        occurredAt: new Date().toISOString(),
        recipients,
        payload: {
          title: 'Falha ao publicar conteúdo',
          body: 'Uma publicação programada não foi concluída. Revise o conteúdo e a integração.',
          actionUrl: `/social/planner/content/${encodeURIComponent(publication.contentItemId)}`,
          publicationId: publication.id,
          contentItemId: publication.contentItemId,
          failureReason: publication.failureReason ?? 'unknown',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit publication failure notification for ${publication.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async resolveRecipients(
    publication: FailedSocialPublication,
  ): Promise<NotificationExplicitRecipient[]> {
    const members = await this.workspaceUsersRepository.find({
      where: {
        tenantId: publication.tenantId,
        workspaceId: publication.workspaceId,
        status: 'active',
      },
    });

    const recipients = await Promise.all(
      members.map(async (member) => {
        if (!member.userId) return null;

        const context = {
          tenantId: publication.tenantId,
          workspaceId: publication.workspaceId,
          userId: member.userId,
          role: member.role,
        };

        const [canViewPublication, canAccessSocial] = await Promise.all([
          this.permissions.can(context, VIEW_PUBLICATION_PERMISSION),
          publication.agencyClientId
            ? this.permissions.canAccessClientProduct({
                ...context,
                clientId: publication.agencyClientId,
                productKey: 'social',
              })
            : this.permissions.canAccessProduct(context, 'social'),
        ]);

        if (!canViewPublication || !canAccessSocial) return null;

        return {
          userId: member.userId,
          interestReason: NotificationInterestReason.RESPONSIBLE_ROLE,
        };
      }),
    );

    return recipients.filter(
      (recipient): recipient is NotificationExplicitRecipient => recipient !== null,
    );
  }
}
