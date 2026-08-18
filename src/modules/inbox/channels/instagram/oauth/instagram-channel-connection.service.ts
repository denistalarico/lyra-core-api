import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';

export type InstagramAuthorizationMethod = 'instagram_login' | 'facebook_login';

type ConnectInstagramChannelInput = {
  session: InboxChannelConnectionSessionEntity;
  accountId: string;
  scopedId: string | null;
  username: string | null;
  accessToken: string;
  tokenType: string | null;
  tokenExpiresIn: number | null;
  permissions: string[];
  authorizationMethod: InstagramAuthorizationMethod;
  facebookPageId?: string | null;
};

@Injectable()
export class InstagramChannelConnectionService {
  constructor(private readonly cryptoService: SettingsCryptoService) {}

  async connect(manager: EntityManager, input: ConnectInstagramChannelInput) {
    await this.lockInstagramAccount(manager, input.session, [
      input.accountId,
      ...(input.scopedId ? [input.scopedId] : []),
    ]);

    const channels = manager.getRepository(InboxChannelEntity);
    const providerAccountIds = [input.accountId, input.scopedId]
      .filter((value): value is string => Boolean(value))
      .filter((value, index, values) => values.indexOf(value) === index);
    const existing = await channels.findOne({
      where: providerAccountIds.flatMap((providerAccountId) =>
        (['externalAccountId', 'externalId'] as const).map((property) => ({
          tenantId: input.session.tenantId,
          workspaceId: input.session.workspaceId,
          type: 'instagram' as const,
          provider: 'meta',
          [property]: providerAccountId,
          deletedAt: IsNull(),
        })),
      ),
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
    const expiresAt = this.tokenExpiresAt(connectedAt, input.tokenExpiresIn);
    const encryptedToken = this.cryptoService.encrypt(input.accessToken);

    if (!encryptedToken) {
      throw new BadRequestException('Instagram credential encryption failed.');
    }

    const channel =
      existing ??
      channels.create({
        tenantId: input.session.tenantId,
        workspaceId: input.session.workspaceId,
        name: input.username ?? `Instagram ${input.accountId}`,
        type: 'instagram',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        lifecycleVersion: 1,
        credentialVersion: 0,
        aiEnabled: false,
        settings: {},
        metadata: {},
      });

    channel.type = 'instagram';
    channel.provider = 'meta';
    channel.externalAccountId = input.accountId;
    if (input.scopedId || !existing) {
      channel.externalId = input.scopedId;
    }
    channel.externalPageId =
      input.authorizationMethod === 'facebook_login'
        ? (input.facebookPageId ?? null)
        : null;
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
      username: input.username,
      connectionSessionId: input.session.id,
      connectedAt: connectedAt.toISOString(),
      tokenType: input.tokenType,
      tokenExpiresAt: expiresAt?.toISOString() ?? null,
      grantedPermissions: input.permissions,
      ...(input.scopedId ? { instagramScopedId: input.scopedId } : {}),
      ...(input.authorizationMethod === 'facebook_login'
        ? { facebookPageId: input.facebookPageId ?? null }
        : {}),
    };
    if (input.authorizationMethod === 'instagram_login') {
      delete channel.metadata.facebookPageId;
    }

    return channels.save(channel);
  }

  private async lockInstagramAccount(
    manager: EntityManager,
    session: InboxChannelConnectionSessionEntity,
    accountIds: readonly string[],
  ) {
    const providerAccountIds = [...new Set(accountIds)].sort();
    for (const accountId of providerAccountIds) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [
          `${session.tenantId}:${session.workspaceId}`,
          `instagram:meta:${accountId}`,
        ],
      );
    }
  }

  private tokenExpiresAt(startedAt: Date, expiresIn: number | null) {
    if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return null;
    }

    return new Date(startedAt.getTime() + expiresIn * 1000);
  }
}
