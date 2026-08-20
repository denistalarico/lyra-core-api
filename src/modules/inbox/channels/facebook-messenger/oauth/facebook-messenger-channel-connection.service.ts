import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';

export type FacebookMessengerAuthorizationMethod = 'facebook_login';

type ConnectFacebookMessengerChannelInput = {
  session: InboxChannelConnectionSessionEntity;
  pageId: string;
  pageName: string | null;
  pageTasks: string[];
  pageAccessToken: string;
  subscribedFields: readonly string[];
  authorizationMethod: FacebookMessengerAuthorizationMethod;
};

/**
 * Messenger channels are identified by the Facebook Page itself, so the
 * dedupe key is (tenant, workspace, type=facebook_messenger, PAGE_ID).
 * The `type` predicate is part of the identity on purpose: the same Page may
 * already back an `instagram` channel, which must never be touched here.
 */
@Injectable()
export class FacebookMessengerChannelConnectionService {
  constructor(private readonly cryptoService: SettingsCryptoService) {}

  async connect(
    manager: EntityManager,
    input: ConnectFacebookMessengerChannelInput,
  ) {
    await this.lockMessengerPage(manager, input.session, input.pageId);

    const channels = manager.getRepository(InboxChannelEntity);
    const existing = await channels.findOne({
      where: {
        tenantId: input.session.tenantId,
        workspaceId: input.session.workspaceId,
        type: 'facebook_messenger',
        provider: 'meta',
        externalAccountId: input.pageId,
        deletedAt: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });
    const wasDisconnected = Boolean(
      existing &&
      (existing.status !== 'active' ||
        existing.connectionStatus !== 'connected' ||
        existing.disconnectedAt ||
        existing.credentialRemovedAt),
    );
    const connectedAt = new Date();
    const encryptedToken = this.cryptoService.encrypt(input.pageAccessToken);

    if (!encryptedToken) {
      throw new BadRequestException('Messenger credential encryption failed.');
    }

    const channel =
      existing ??
      channels.create({
        tenantId: input.session.tenantId,
        workspaceId: input.session.workspaceId,
        name: input.pageName ?? `Messenger ${input.pageId}`,
        type: 'facebook_messenger',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        lifecycleVersion: 1,
        credentialVersion: 0,
        aiEnabled: false,
        settings: {},
        metadata: {},
      });

    channel.type = 'facebook_messenger';
    channel.provider = 'meta';
    channel.externalAccountId = input.pageId;
    channel.externalId = input.pageId;
    channel.externalPageId = input.pageId;
    channel.status = 'active';
    channel.connectionStatus = 'connected';
    channel.accessTokenEncrypted = encryptedToken;
    channel.credentialVersion = (existing?.credentialVersion ?? 0) + 1;
    channel.lifecycleVersion = existing
      ? (existing.lifecycleVersion || 1) + (wasDisconnected ? 1 : 0)
      : 1;
    channel.suspendedAt = null;
    channel.disconnectedAt = null;
    channel.disconnectedBy = null;
    channel.disconnectReason = null;
    channel.credentialRemovedAt = null;
    channel.settings = {
      ...(existing?.settings ?? {}),
      connectionHealth: 'ok',
    };
    channel.metadata = {
      ...(existing?.metadata ?? {}),
      authorizationMethod: input.authorizationMethod,
      facebookPageId: input.pageId,
      pageName: input.pageName,
      pageTasks: input.pageTasks,
      tokenType: 'page_access_token',
      tokenExpiresAt: null,
      webhookSubscribedFields: [...input.subscribedFields],
      connectionSessionId: input.session.id,
      connectedAt: connectedAt.toISOString(),
    };

    return channels.save(channel);
  }

  private async lockMessengerPage(
    manager: EntityManager,
    session: InboxChannelConnectionSessionEntity,
    pageId: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [
        `${session.tenantId}:${session.workspaceId}`,
        `facebook_messenger:meta:${pageId}`,
      ],
    );
  }
}
